// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * The client's overview: a month in a sentence, the trend behind it, and what has actually happened.
 *
 * ── Why there is a feed when there is no event table ────────────────────────────────────────────
 * Nothing in the database records "an event". So the feed is assembled from the three things that
 * carry a timestamp and mean something to a client: a reply arriving, a campaign launching, a meeting
 * being booked. Each is read from its own table, given a kind and a time, merged and sorted.
 *
 * That is honest about its limits and the shape says so: it is a list of things that happened, not an
 * audit log. Nothing is inferred, nothing is invented, and an item only appears if a row exists for it.
 *
 * ── Why two windows ────────────────────────────────────────────────────────────────────────────
 * The briefing talks about the last thirty days, because "how are we doing" is a question about recent
 * work. The funnel is all-time, because "what has this produced" is a question about the whole
 * engagement. Mixing them would answer neither.
 */
import { NextResponse } from "next/server";
import { resolveScope } from "../../lib/auth-context";
import { num, scopedByConversation, scopedCount, scopedRows, str, type Row } from "../../lib/db";
import type { Session } from "../../lib/session";

export const maxDuration = 60;

const DAY_MS = 86_400_000;
/**
 * The ranges the page offers, in the order the buttons appear.
 *
 * A week is the default because these are weekly-call clients: the question somebody opens this page to
 * answer is "what happened since we last spoke". `days: null` is all time, which is a different
 * computation — campaign totals rather than a sum over daily rows — and the funnel it produces has two
 * extra steps that only exist over the whole engagement.
 */
export const RANGES: Record<string, { label: string; days: number | null }> = {
  week: { label: "This week", days: 7 },
  month: { label: "This month", days: 30 },
  all: { label: "All time", days: null },
};
/** Buckets in each sparkline. Seven reads as a shape without pretending to daily precision. */
const BUCKETS = 7;

export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("client");

  let scope;
  try {
    scope = await resolveScope(slug);
  } catch {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }
  const { session, workspaceId } = scope;

  // Staff with no client named get the directory instead; the page renders that.
  if (!workspaceId) {
    const clients = await scopedRows(session, "rr_workspaces", {
      select: "id,name,slug,logo_url,accent_color",
      order: "name.asc",
    });
    return NextResponse.json({
      ok: true,
      view: "directory",
      clients: clients.map((row) => ({
        id: str(row.id),
        name: str(row.name),
        slug: str(row.slug),
        logoUrl: row.logo_url ? str(row.logo_url) : null,
        accentColor: row.accent_color ? str(row.accent_color) : null,
      })),
    });
  }

  try {
    const asked = new URL(request.url).searchParams.get("range") ?? "week";
    const range = asked in RANGES ? asked : "week";
    return NextResponse.json({ ok: true, view: "client", ...(await build(session, workspaceId, range)) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "The overview did not load." },
      { status: 502 },
    );
  }
}

async function build(session: Session, workspaceId: string, range: string) {
  const now = Date.now();
  const { label: rangeLabel, days: windowDays } = RANGES[range];
  /*
   * All time has no start, so the window is opened at the epoch rather than special-cased through every
   * sum below. The figures then come out the same way for all three ranges and only the funnel differs.
   */
  const windowStart = windowDays === null ? 0 : now - windowDays * DAY_MS;
  const previousStart = windowDays === null ? 0 : windowStart - windowDays * DAY_MS;

  const [workspaceRows, campaignRows, dailyRows, conversations, meetings] = await Promise.all([
    scopedRows(session, "rr_workspaces", { select: "id,name,slug,logo_url,accent_color,website_url", limit: "1" }, workspaceId),
    scopedRows(
      session,
      "rr_campaign_stats",
      { select: "campaign_id,name,status,launched_at,sender_ids,total_leads,leads_pending,connections_sent,connections_accepted,replies" },
      workspaceId,
    ),
    scopedRows(session, "rr_daily_stats", { select: "day,sender_id,sender_name,connections_sent,connections_accepted", limit: "5000" }, workspaceId),
    scopedRows(
      session,
      "rr_conversations",
      { select: "id,lead_id,last_message_at,last_message_direction", order: "last_message_at.desc", limit: "400" },
      workspaceId,
    ),
    scopedRows(
      session,
      "rr_meetings",
      { select: "id,invitee_name,invitee_title,company_name,meeting_at,created_at,campaign,status", order: "created_at.desc", limit: "50" },
      workspaceId,
    ),
  ]);

  const workspace = workspaceRows[0];
  if (!workspace) throw new Error("That client was not found.");

  // The people behind those conversations, for the feed and the latest-replies list.
  const leadIds = [...new Set(conversations.map((row) => str(row.lead_id)).filter(Boolean))].slice(0, 300);
  const leads = leadIds.length
    ? await scopedRows(
        session,
        "rr_leads",
        { select: "id,name,role,company,linkedin_profile_url,raw_data", id: `in.(${leadIds.join(",")})`, limit: String(leadIds.length) },
        workspaceId,
      )
    : [];
  const leadById = new Map(leads.map((row) => [str(row.id), row]));

  // Inbound messages, for reply counts by date and the sentiment on each.
  const conversationIds = conversations.map((row) => str(row.id)).filter(Boolean);
  const inbound = conversationIds.length
    ? await scopedByConversation(
        session,
        "rr_messages",
        conversationIds,
        {
          // The body is what makes the network worth looking at — the actual words somebody replied,
          // not a label saying a reply happened. It was never selected before, so every "quote" on the
          // old feed would have had to be invented; now there is a real one to show.
          select: "conversation_id,sent_at,body,sentiment:raw_data->reply_radar->>sentiment,campaign:raw_data->reply_radar->campaign->>name",
          direction: "eq.inbound",
          limit: "1000",
        },
        workspaceId,
      ).catch(() => [] as Row[])
    : [];

  // ── The two windows ──────────────────────────────────────────────────────────────────────────

  const inWindow = (iso: string, from: number, to: number) => {
    const at = Date.parse(iso);
    return Number.isFinite(at) && at >= from && at < to;
  };

  /** Client-wide daily rows only — `sender_id = ''` is the total the worker stores beside the per-sender ones. */
  const totals = dailyRows.filter((row) => !str(row.sender_id));
  const sumDaily = (from: number, to: number, field: "connections_sent" | "connections_accepted") =>
    totals.reduce((total, row) => (inWindow(`${str(row.day).slice(0, 10)}T12:00:00Z`, from, to) ? total + num(row[field]) : total), 0);

  const reached30 = sumDaily(windowStart, now + DAY_MS, "connections_sent");
  const accepted30 = sumDaily(windowStart, now + DAY_MS, "connections_accepted");
  const reachedPrev = sumDaily(previousStart, windowStart, "connections_sent");

  const replies30 = inbound.filter((row) => inWindow(str(row.sent_at), windowStart, now + DAY_MS));
  const repliesPrev = inbound.filter((row) => inWindow(str(row.sent_at), previousStart, windowStart)).length;
  const scored30 = replies30.filter((row) => ["positive", "neutral", "negative"].includes(str(row.sentiment).toLowerCase()));
  const positive30 = scored30.filter((row) => str(row.sentiment).toLowerCase() === "positive").length;

  const allTime = campaignRows.reduce<{ leads: number; reached: number; accepted: number; replies: number }>(
    (acc, row) => ({
      leads: acc.leads + Math.max(num(row.total_leads), num(row.connections_sent)),
      reached: acc.reached + num(row.connections_sent),
      accepted: acc.accepted + num(row.connections_accepted),
      replies: acc.replies + num(row.replies),
    }),
    { leads: 0, reached: 0, accepted: 0, replies: 0 },
  );
  const positiveAllTime = inbound.filter((row) => str(row.sentiment).toLowerCase() === "positive").length;

  /** Conversations where the lead spoke last — the ones waiting on a response. */
  const waiting = conversations.filter((row) => str(row.last_message_direction) === "inbound").length;

  // ── Sparklines ───────────────────────────────────────────────────────────────────────────────

  const bucketOf = (iso: string) => {
    const at = Date.parse(iso);
    if (!Number.isFinite(at) || at < windowStart) return -1;
    const span = (windowDays ?? 365) * DAY_MS;
    return Math.min(BUCKETS - 1, Math.floor(((at - windowStart) / span) * BUCKETS));
  };

  const spark = () => Array.from({ length: BUCKETS }, () => 0);
  const reachedSeries = spark();
  const acceptedSeries = spark();
  const repliesSeries = spark();
  const positiveSeries = spark();
  const scoredSeries = spark();

  for (const row of totals) {
    const bucket = bucketOf(`${str(row.day).slice(0, 10)}T12:00:00Z`);
    if (bucket < 0) continue;
    reachedSeries[bucket] += num(row.connections_sent);
    acceptedSeries[bucket] += num(row.connections_accepted);
  }
  for (const row of replies30) {
    const bucket = bucketOf(str(row.sent_at));
    if (bucket < 0) continue;
    repliesSeries[bucket] += 1;
    const verdict = str(row.sentiment).toLowerCase();
    if (["positive", "neutral", "negative"].includes(verdict)) scoredSeries[bucket] += 1;
    if (verdict === "positive") positiveSeries[bucket] += 1;
  }
  // A rate per bucket, not a count — the tile above it is a percentage.
  const positiveRateSeries = positiveSeries.map((value, index) =>
    scoredSeries[index] ? Math.round((value / scoredSeries[index]) * 100) : 0,
  );

  // ── The feed ─────────────────────────────────────────────────────────────────────────────────

  /** The newest inbound message per conversation, so a thread appears once rather than per reply. */
  const newestReply = new Map<string, Row>();
  for (const row of inbound) {
    const key = str(row.conversation_id);
    const seen = newestReply.get(key);
    if (!seen || str(row.sent_at) > str(seen.sent_at)) newestReply.set(key, row);
  }

  type Event = {
    kind: "reply" | "positive" | "launch" | "meeting";
    at: string;
    title: string;
    detail: string;
    /** Everything the living network needs beyond the two headline strings. */
    name?: string;
    initials?: string;
    photoUrl?: string | null;
    where?: string;
    campaign?: string | null;
    sender?: string | null;
    quote?: string | null;
    conversationId?: string;
  };
  const events: Event[] = [];

  /** Two letters for a node with no photo. "Charlie" is a real one-word lead; a naive split throws on it. */
  const initialsOf = (value: string) => {
    const words = value.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "?";
    return (words.length === 1 ? words[0].slice(0, 1) : words[0][0] + words[words.length - 1][0]).toUpperCase();
  };

  /**
   * A reply body, trimmed to something that fits beside a face.
   *
   * These come off LinkedIn, so they run from one word to several paragraphs. The card wants a taste,
   * not the whole thread, and a broken-off sentence with an ellipsis reads as "there is more" — which
   * there is, one click away in the inbox.
   */
  const taste = (body: string) => {
    const clean = body.replace(/\s+/g, " ").trim();
    if (clean.length <= 150) return clean;
    const cut = clean.slice(0, 150);
    const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    return (stop > 90 ? cut.slice(0, stop + 1) : cut.trimEnd() + "…");
  };

  for (const conversation of conversations) {
    const message = newestReply.get(str(conversation.id));
    if (!message) continue;
    const lead = leadById.get(str(conversation.lead_id));
    if (!lead) continue;
    const name = str(lead.name) || "Someone";
    const where = [str(lead.role), str(lead.company)].filter(Boolean).join(" @ ");
    const campaign = str(message.campaign);
    const isPositive = str(message.sentiment).toLowerCase() === "positive";

    // The photo already loaded for the inbox and the lead table, from the scoped enrichment blob.
    const radar = ((lead.raw_data as Record<string, unknown>)?.reply_radar ?? {}) as Record<string, unknown>;
    const enrichment = (radar.ai_ark ?? {}) as Record<string, unknown>;
    const rollup = (radar.rollup ?? {}) as Record<string, unknown>;
    const senderNames = str(rollup.sender_names);

    const body = str(message.body);
    events.push({
      kind: isPositive ? "positive" : "reply",
      at: str(message.sent_at) || str(conversation.last_message_at),
      title: isPositive ? `${name} replied — positive` : `${name} replied`,
      detail: [where, campaign].filter(Boolean).join(" · "),
      name,
      initials: initialsOf(name),
      photoUrl: enrichment.profilePhotoSource ? str(enrichment.profilePhotoSource) : null,
      where,
      campaign: campaign || null,
      // The rollup is already scoped to this client, so this sender is theirs and not another tenant's.
      sender: senderNames ? senderNames.split(";")[0].trim() : null,
      // Every reply carries its words — a card with a name and no message read as broken ("X replied" with
      // nothing under it). The sentiment still colours it; the quote just always shows.
      quote: body ? taste(body) : null,
      conversationId: str(conversation.id),
    });
  }

  for (const row of campaignRows) {
    const launched = str(row.launched_at);
    if (!launched) continue;
    const senders = Array.isArray(row.sender_ids) ? row.sender_ids.length : 0;
    const leadCount = Math.max(num(row.total_leads), num(row.connections_sent));
    events.push({
      kind: "launch",
      at: launched,
      title: `${str(row.name) || "A campaign"} launched`,
      detail: [
        leadCount ? `${leadCount.toLocaleString()} leads` : "",
        senders ? `${senders} sender${senders === 1 ? "" : "s"}` : "",
      ].filter(Boolean).join(" · "),
    });
  }

  for (const row of meetings) {
    const at = str(row.created_at) || str(row.meeting_at);
    if (!at) continue;
    events.push({
      kind: "meeting",
      at,
      title: `Meeting booked with ${str(row.invitee_name) || "a lead"}`,
      detail: [str(row.invitee_title), str(row.company_name), str(row.campaign)].filter(Boolean).join(" · "),
    });
  }

  const feed = events
    .filter((event) => Number.isFinite(Date.parse(event.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 24);

  // ── Supporting lists ─────────────────────────────────────────────────────────────────────────

  const rate = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

  const bestCampaigns = campaignRows
    .map((row) => ({
      name: str(row.name),
      reached: num(row.connections_sent),
      accepted: num(row.connections_accepted),
      replyRate: rate(num(row.replies), num(row.connections_accepted)),
    }))
    // Fifty requests is Reply Radar's threshold for a rate meaning anything.
    .filter((row) => row.reached >= 50)
    .sort((a, b) => b.replyRate - a.replyRate)
    .slice(0, 4);

  /** Who sent the most in the window, for the briefing's footer. */
  const bySender = new Map<string, number>();
  for (const row of dailyRows) {
    const name = str(row.sender_name);
    if (!name || !inWindow(`${str(row.day).slice(0, 10)}T12:00:00Z`, windowStart, now + DAY_MS)) continue;
    bySender.set(name, (bySender.get(name) ?? 0) + num(row.connections_sent));
  }
  const busiestSender = [...bySender.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;

  /*
   * The funnel for the chosen range.
   *
   * All time gets two extra steps at the top — how many leads were loaded, and how many of them were
   * actually reached — because those only mean anything over the whole engagement. A week's "leads in
   * campaigns" would be the same 15,259 every week and would say nothing.
   *
   * `of` names the denominator of each rate rather than leaving the reader to guess. That matters most
   * on the last step: warm replies are counted against the ones actually read, which on a short range is
   * a much smaller number than the replies received, and a percentage with no denominator beside it is
   * the kind of figure a client quotes back at you.
   */
  const funnel = windowDays === null
    ? [
        { key: "leads", label: "Leads in campaigns", value: allTime.leads, tone: "f0", rate: null as number | null, of: null as string | null },
        { key: "reached", label: "Reached out to", value: allTime.reached, tone: "f1", rate: rate(allTime.reached, allTime.leads), of: "of leads" },
        { key: "accepted", label: "Accepted", value: allTime.accepted, tone: "f2", rate: rate(allTime.accepted, allTime.reached), of: "of reached" },
        { key: "replied", label: "Replied", value: allTime.replies, tone: "f3", rate: rate(allTime.replies, allTime.accepted), of: "of accepted" },
        { key: "warm", label: "Replied positively", value: positiveAllTime, tone: "f4", rate: rate(positiveAllTime, allTime.replies), of: "of replies" },
      ]
    : [
        { key: "reached", label: "Reached", value: reached30, tone: "f1", rate: null as number | null, of: null as string | null },
        { key: "accepted", label: "Accepted", value: accepted30, tone: "f2", rate: rate(accepted30, reached30), of: "of reached" },
        { key: "replied", label: "Replied", value: replies30.length, tone: "f3", rate: rate(replies30.length, accepted30), of: "of accepted" },
        { key: "warm", label: "Replied positively", value: positive30, tone: "f4", rate: rate(positive30, scored30.length), of: `of ${scored30.length} read closely` },
      ];

  /**
   * The campaigns actually running, with what each has left to work through.
   *
   * `leads_pending` is the part worth having and the part no other screen shows: a campaign with 40
   * leads left is nearly finished, and that is a fact somebody would want before a weekly call rather
   * than after it.
   */
  const senderNameById = new Map<string, string>();
  for (const row of dailyRows) {
    const id = str(row.sender_id);
    const name = str(row.sender_name);
    if (id && name && !senderNameById.has(id)) senderNameById.set(id, name);
  }

  const activeCampaigns = campaignRows
    .filter((row) => (str(row.status) || "").toUpperCase() === "IN_PROGRESS")
    .map((row) => {
      const senderIds = Array.isArray(row.sender_ids) ? row.sender_ids.map((id) => str(id)).filter(Boolean) : [];
      const sent = num(row.connections_sent);
      const accepted = num(row.connections_accepted);
      const leads = Math.max(num(row.total_leads), sent);
      const pending = num(row.leads_pending);
      return {
        campaignId: str(row.campaign_id),
        name: str(row.name) || "Untitled campaign",
        launchedAt: row.launched_at ? str(row.launched_at) : null,
        // Names where the daily rows know them; never a raw id where a name belongs.
        senders: senderIds.map((id) => senderNameById.get(id)).filter((name): name is string => Boolean(name)),
        senderCount: senderIds.length,
        totalLeads: leads,
        leadsPending: pending,
        connectionsSent: sent,
        connectionsAccepted: accepted,
        replies: num(row.replies),
        acceptanceRate: rate(accepted, sent),
        replyRate: rate(num(row.replies), accepted),
        // How much of the list has been worked, which is the one thing a running campaign is judged on.
        progress: leads > 0 ? Math.min(100, Math.round((sent / leads) * 100)) : 0,
      };
    })
    .sort((a, b) => (b.launchedAt ?? "").localeCompare(a.launchedAt ?? "") || a.name.localeCompare(b.name));

  const launchedAt = campaignRows
    .map((row) => str(row.launched_at))
    .filter(Boolean)
    .sort()[0] ?? null;

  // The real size of this client's lead database — distinct people in rr_leads, counted with a cheap
  // Content-Range header, NOT the sum of every campaign's list size (which double-counts anyone who was
  // loaded into more than one campaign — that sum is what showed a wildly inflated 15k).
  const leadsCount = await scopedCount(session, "rr_leads", {}, workspaceId).catch(() => allTime.leads);

  // Weekly trend, last 13 weeks (Monday-anchored): total replies, positive replies, booked meetings per week.
  const WEEKS_BACK = 13;
  const weekStart = (ms: number) => { const d = new Date(ms); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); d.setUTCHours(0, 0, 0, 0); return d.getTime(); };
  const firstWeek = weekStart(now) - (WEEKS_BACK - 1) * 7 * DAY_MS;
  const weekIndex = (ms: number) => { const idx = Math.round((weekStart(ms) - firstWeek) / (7 * DAY_MS)); return idx >= 0 && idx < WEEKS_BACK ? idx : -1; };
  const weeklyTrends = Array.from({ length: WEEKS_BACK }, (_, i) => ({ week: new Date(firstWeek + i * 7 * DAY_MS).toISOString().slice(0, 10), total: 0, positive: 0, meetings: 0, sent: 0 }));
  for (const row of inbound) { const idx = weekIndex(Date.parse(str(row.sent_at))); if (idx < 0) continue; weeklyTrends[idx].total += 1; if (str(row.sentiment).toLowerCase() === "positive") weeklyTrends[idx].positive += 1; }
  for (const row of meetings) { const at = str(row.created_at) || str(row.meeting_at); if (!at) continue; const idx = weekIndex(Date.parse(at)); if (idx < 0) continue; weeklyTrends[idx].meetings += 1; }
  for (const row of totals) { const idx = weekIndex(Date.parse(`${str(row.day).slice(0, 10)}T12:00:00Z`)); if (idx < 0) continue; weeklyTrends[idx].sent += num(row.connections_sent); }

  return {
    client: {
      id: str(workspace.id),
      name: str(workspace.name),
      slug: str(workspace.slug),
      logoUrl: workspace.logo_url ? str(workspace.logo_url) : null,
      accentColor: workspace.accent_color ? str(workspace.accent_color) : null,
    },
    startedAt: launchedAt,
    range,
    rangeLabel,
    ranges: Object.entries(RANGES).map(([key, value]) => ({ key, label: value.label })),
    window: {
      days: windowDays,
      reached: reached30,
      accepted: accepted30,
      replies: replies30.length,
      scored: scored30.length,
      positive: positive30,
      positiveRate: rate(positive30, scored30.length),
      acceptanceRate: rate(accepted30, reached30),
      // Reply rate is out of accepted connections — nobody replies to a request that was never accepted.
      replyRate: rate(replies30.length, accepted30),
      // The previous window, so the briefing can say whether this one was better.
      previousReached: reachedPrev,
      previousReplies: repliesPrev,
    },
    allTime: {
      ...allTime,
      positive: positiveAllTime,
      acceptanceRate: rate(allTime.accepted, allTime.reached),
      replyRate: rate(allTime.replies, allTime.accepted),
      positiveRate: rate(positiveAllTime, allTime.accepted),
    },
    waiting,
    campaignsRunning: campaignRows.filter((row) => (str(row.status) || "").toUpperCase() === "IN_PROGRESS").length,
    campaignsTotal: campaignRows.length,
    sendersActive: bySender.size,
    busiestSender: busiestSender ? { name: busiestSender[0], sent: busiestSender[1] } : null,
    funnel,
    activeCampaigns,
    // The people behind the outreach, for the network's anchor nodes. Names, never ids.
    senders: [...new Set(dailyRows.map((row) => str(row.sender_name)).filter(Boolean))].slice(0, 8),
    bestCampaigns,
    weeklyTrends,
    /** For the tiles that link into the other tabs. */
    leadsTotal: leadsCount,
    /** Every connection request sent across all campaigns — people actually reached out to. */
    reachedTotal: allTime.reached,
    repliesTotal: allTime.replies,
    meetingsBooked: meetings.length,
    meetingsUpcoming: meetings.filter((row) => row.meeting_at && Date.parse(str(row.meeting_at)) > now).length,
    sparklines: {
      reached: reachedSeries,
      accepted: acceptedSeries,
      replies: repliesSeries,
      positiveRate: positiveRateSeries,
    },
    feed,
  };
}
