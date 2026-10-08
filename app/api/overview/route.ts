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
import { num, scopedByConversation, scopedRows, str, type Row } from "../../lib/db";
import type { Session } from "../../lib/session";
import { qcConversations } from "../../lib/qc-conversations";

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
    const params = new URL(request.url).searchParams;
    const asked = params.get("range") ?? "week";
    // A custom range from the calendar: two YYYY-MM-DD days, inclusive, in order, ending no later than
    // today and spanning at most two years. Anything else is refused rather than guessed at.
    if (asked === "custom") {
      const from = params.get("from") ?? "", to = params.get("to") ?? "";
      const valid = /^\d{4}-\d{2}-\d{2}$/;
      const start = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`);
      const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
      if (!valid.test(from) || !valid.test(to) || !Number.isFinite(start) || !Number.isFinite(end) || start > end || end > today || end - start > 731 * DAY_MS) {
        return NextResponse.json({ ok: false, error: "Pick a start and end date, ending today or earlier." }, { status: 400 });
      }
      return NextResponse.json({ ok: true, view: "client", ...(await build(session, workspaceId, "custom", { from, to })) });
    }
    const range = asked in RANGES ? asked : "week";
    return NextResponse.json({ ok: true, view: "client", ...(await build(session, workspaceId, range)) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "The overview did not load." },
      { status: 502 },
    );
  }
}

async function build(session: Session, workspaceId: string, range: string, custom?: { from: string; to: string }) {
  const now = Date.now();
  const customStart = custom ? Date.parse(`${custom.from}T00:00:00Z`) : 0;
  const customEnd = custom ? Date.parse(`${custom.to}T00:00:00Z`) + DAY_MS : 0;
  const shortDate = (ms: number, year = false) => new Date(ms).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}) });
  const { label: rangeLabel, days: windowDays } = custom
    ? {
        label: custom.from === custom.to ? shortDate(customStart, true) : `${shortDate(customStart)} – ${shortDate(customEnd - DAY_MS, true)}`,
        days: Math.round((customEnd - customStart) / DAY_MS),
      }
    : RANGES[range];
  /** Where the window closes: the end of the chosen last day for a custom range, otherwise now (plus slack for today). */
  const windowEnd = custom ? customEnd : now + DAY_MS;
  /*
   * All time has no start, so the window is opened at the epoch rather than special-cased through every
   * sum below. The figures then come out the same way for all three ranges and only the funnel differs.
   */
  const windowStart = custom ? customStart : windowDays === null ? 0 : now - windowDays * DAY_MS;
  const previousStart = windowDays === null ? 0 : windowStart - windowDays * DAY_MS;

  // The two exact counts depend on nothing else, so they ride along with the first batch rather than
  // adding two more round trips at the end.
  // QC's conversations only (lib/qc-conversations): read alongside the batch, applied right after it.
  const qcPromise = qcConversations(session, workspaceId);
  const [workspaceRows, campaignRows, dailyRows, allConversations, meetings, , , overrideRows] = await Promise.all([
    scopedRows(session, "rr_workspaces", { select: "id,name,slug,logo_url,accent_color,website_url", limit: "1" }, workspaceId),
    scopedRows(
      session,
      "rr_campaign_stats",
      { select: "campaign_id,name,status,launched_at,sender_ids,total_leads,leads_pending,connections_sent,connections_accepted,replies,messages_started" },
      workspaceId,
    ),
    scopedRows(session, "rr_daily_stats", { select: "day,sender_id,sender_name,daily_limit,connections_sent,connections_accepted,refreshed_at", limit: "5000" }, workspaceId),
    scopedRows(
      session,
      "rr_conversations",
      { select: "id,lead_id,last_message_at,last_message_direction,channel,heyreach_conversation_id", order: "last_message_at.desc", limit: "600" },
      workspaceId,
    ),
    scopedRows(
      session,
      "rr_meetings",
      { select: "id,invitee_name,invitee_title,company_name,meeting_at,created_at,campaign,status", order: "created_at.desc", limit: "500" },
      workspaceId,
    ),
    // (The lead and reply totals used to be table counts here; they now come from QC's own sets below.)
    Promise.resolve(null),
    Promise.resolve(null),
    // A staff-set "Meetings booked" figure, when there is one. Empty (not an error) if the table has not
    // been created yet, so the page keeps working on the automatic count.
    scopedRows(session, "qc_portal_meeting_overrides", { select: "meetings_booked,set_at", limit: "1" }, workspaceId).catch(() => [] as Row[]),
  ]);

  const workspace = workspaceRows[0];
  if (!workspace) throw new Error("That client was not found.");

  /*
   * Everything below — replies, the feed, the chart, the calendar, "waiting" — is built from these, so
   * replies to the client's own (non-QC) campaigns never reach a single figure. Replies and the lead
   * database are the exact sizes of QC's own sets, not table counts that include the client's work.
   */
  const qc = await qcPromise;
  const conversations = allConversations.filter((row) => qc.ids.has(str(row.id)));
  const repliesCountRaw: number | null = qc.ids.size;
  const leadsCountRaw: number | null = qc.leadIds.size;

  // The people behind those conversations and the inbound messages both hang off `conversations` and
  // nothing else, so they are fetched together rather than one after the other.
  // Leads are only needed to name people in the 24-card feed, and conversations arrive newest first, so
  // the most recent hundred cover it with room to spare — without reading a lead per conversation.
  const leadIds = [...new Set(conversations.map((row) => str(row.lead_id)).filter(Boolean))].slice(0, 100);
  const conversationIds = conversations.map((row) => str(row.id)).filter(Boolean);
  const [leads, inbound] = await Promise.all([
    leadIds.length
      ? scopedRows(
          session,
          "rr_leads",
          {
            // Only the photo out of raw_data, never the blob: the whole HeyReach payload per lead made this
            // the slowest read on the page (and timed out under load). The photo is per-person enrichment
            // with nothing client-specific in it; the sender comes from the message below instead of the
            // lead's cross-client rollup.
            select: "id,name,role,company,linkedin_profile_url,photo:raw_data->reply_radar->ai_ark->>profilePhotoSource",
            id: `in.(${leadIds.join(",")})`,
            limit: String(leadIds.length),
          },
          workspaceId,
        )
      : Promise.resolve([] as Row[]),
    conversationIds.length
      ? scopedByConversation(
          session,
          "rr_messages",
          conversationIds,
          {
            // The body is what makes the network worth looking at — the actual words somebody replied,
            // not a label saying a reply happened. It was never selected before, so every "quote" on the
            // old feed would have had to be invented; now there is a real one to show.
            select: "conversation_id,sent_at,body,sentiment:raw_data->reply_radar->>sentiment,campaign:raw_data->reply_radar->campaign->>name,sender:raw_data->reply_radar->sender->>name",
            direction: "eq.inbound",
            limit: "1000",
          },
          workspaceId,
        ).catch(() => [] as Row[])
      : Promise.resolve([] as Row[]),
  ]);
  const leadById = new Map(leads.map((row) => [str(row.id), row]));

  // ── The two windows ──────────────────────────────────────────────────────────────────────────

  const inWindow = (iso: string, from: number, to: number) => {
    const at = Date.parse(iso);
    return Number.isFinite(at) && at >= from && at < to;
  };

  /** Client-wide daily rows only — `sender_id = ''` is the total the worker stores beside the per-sender ones. */
  const totals = dailyRows.filter((row) => !str(row.sender_id));
  const sumDaily = (from: number, to: number, field: "connections_sent" | "connections_accepted") =>
    totals.reduce((total, row) => (inWindow(`${str(row.day).slice(0, 10)}T12:00:00Z`, from, to) ? total + num(row[field]) : total), 0);

  const reached30 = sumDaily(windowStart, windowEnd, "connections_sent");
  const accepted30 = sumDaily(windowStart, windowEnd, "connections_accepted");
  const reachedPrev = sumDaily(previousStart, windowStart, "connections_sent");
  const acceptedPrev = sumDaily(previousStart, windowStart, "connections_accepted");

  // Distinct people who replied in the window — one row per conversation (their most recent message in
  // it), NOT one row per message. `inbound` is every inbound message, so counting it raw double-counts
  // anyone who replied more than once — which is how "replied" could read higher than "accepted" and
  // show the same person twice in the live feed. De-duplicating by conversation fixes both.
  const latestReplyPerConversation = (from: number, to: number) => {
    const byConversation = new Map<string, Row>();
    for (const row of inbound) {
      if (!inWindow(str(row.sent_at), from, to)) continue;
      const id = str(row.conversation_id);
      const held = byConversation.get(id);
      if (!held || Date.parse(str(row.sent_at)) > Date.parse(str(held.sent_at))) byConversation.set(id, row);
    }
    return [...byConversation.values()];
  };
  const replies30 = latestReplyPerConversation(windowStart, windowEnd);
  // Rates against LinkedIn sends (connection requests) count LinkedIn replies only: an email reply was never
  // "reached" by a connection request, and counting it pushed the reply rate past what was sent.
  const emailConversations = new Set(allConversations.filter((row) => str(row.channel) === "email" || str(row.heyreach_conversation_id).startsWith("bison:")).map((row) => str(row.id)));
  const linkedinReplies30 = replies30.filter((row) => !emailConversations.has(str(row.conversation_id))).length;
  const repliesPrev = latestReplyPerConversation(previousStart, windowStart).length;
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
  // People whose latest reply was judged positive — QC Command's definition, the one this page already
  // uses for a week or a month, and the one the inbox's "Positive replies" counts. Counting every positive
  // message (or anyone ever positive) gave three different figures for the same client across the portal.
  const positiveAllTime = latestReplyPerConversation(0, now + DAY_MS)
    .filter((row) => str(row.sentiment).toLowerCase() === "positive").length;

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

  const campaignConversations = new Set(inbound.filter((row) => str(row.campaign).trim()).map((row) => str(row.conversation_id)));
  for (const conversation of conversations) {
    const message = newestReply.get(str(conversation.id));
    if (!message) continue;
    const lead = leadById.get(str(conversation.lead_id));
    if (!lead) continue;
    // Someone outside every campaign is hidden from the inbox, so they are not news here either. Read off
    // this client's own messages in the conversation (scoped by conversation), never the lead's rollup.
    if (!campaignConversations.has(str(conversation.id))) continue;
    const name = str(lead.name) || "Someone";
    const where = [str(lead.role), str(lead.company)].filter(Boolean).join(" @ ");
    const campaign = str(message.campaign);
    const isPositive = str(message.sentiment).toLowerCase() === "positive";


    const body = str(message.body);
    events.push({
      kind: isPositive ? "positive" : "reply",
      at: str(message.sent_at) || str(conversation.last_message_at),
      title: isPositive ? `${name} replied — positive` : `${name} replied`,
      detail: [where, campaign].filter(Boolean).join(" · "),
      name,
      initials: initialsOf(name),
      photoUrl: lead.photo ? str(lead.photo) : null,
      where,
      campaign: campaign || null,
      // From the message itself, which belongs to this client's conversation — so the sender is theirs.
      sender: str(message.sender) || null,
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
      // HeyReach's definition, as QC Command shows it: replies over leads messaged (accepted as fallback).
      replyRate: rate(num(row.replies), num(row.messages_started) || num(row.connections_accepted)),
    }))
    // Fifty requests is Reply Radar's threshold for a rate meaning anything.
    .filter((row) => row.reached >= 50)
    .sort((a, b) => b.replyRate - a.replyRate)
    .slice(0, 4);

  /** Who sent the most in the window, for the briefing's footer. */
  const bySender = new Map<string, number>();
  for (const row of dailyRows) {
    const name = str(row.sender_name);
    if (!name || !inWindow(`${str(row.day).slice(0, 10)}T12:00:00Z`, windowStart, windowEnd)) continue;
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
  // The per-sender daily cap HeyReach reports (the highest seen), or 25 when nothing was reported.
  const reportedCaps = dailyRows.map((row) => num(row.daily_limit)).filter((value) => value > 0);
  const senderCap = reportedCaps.length ? Math.max(...reportedCaps) : 25;

  const funnel = windowDays === null
    ? [
        { key: "leads", label: "Leads in campaigns", value: allTime.leads, tone: "f0", rate: null as number | null, of: null as string | null },
        { key: "reached", label: "Reached out to", value: allTime.reached, tone: "f1", rate: rate(allTime.reached, allTime.leads), of: "of leads" },
        { key: "accepted", label: "Accepted", value: allTime.accepted, tone: "f2", rate: rate(allTime.accepted, allTime.reached), of: "of reached" },
        // People who replied, the same figure as the Replies tile and the inbox — not the campaigns' own
        // reply total, which leaves out replies that came in outside a tracked campaign.
        { key: "replied", label: "Replied", value: repliesCountRaw ?? allTime.replies, tone: "f3", rate: rate(repliesCountRaw ?? allTime.replies, allTime.accepted), of: "of accepted" },
        { key: "warm", label: "Replied positively", value: positiveAllTime, tone: "f4", rate: rate(positiveAllTime, repliesCountRaw ?? allTime.replies), of: "of replies" },
      ]
    : [
        { key: "reached", label: "Reached", value: reached30, tone: "f1", rate: null as number | null, of: null as string | null },
        { key: "accepted", label: "Accepted", value: accepted30, tone: "f2", rate: Math.min(100, rate(accepted30, reached30)), of: "of reached" },
        { key: "replied", label: "Replied", value: replies30.length, tone: "f3", rate: Math.min(100, rate(linkedinReplies30, reached30)), of: "of reached" },
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

  // What each sender has sent today, from the per-sender daily rows. "Today" is the UTC calendar day the
  // worker files rows under; a sender with no row for it simply is not shown as sending.
  const todayKey = new Date().toISOString().slice(0, 10);
  const sentTodayBySender = new Map<string, { sent: number; cap: number }>();
  for (const row of dailyRows) {
    const id = str(row.sender_id);
    if (!id || str(row.day).slice(0, 10) !== todayKey) continue;
    const held = sentTodayBySender.get(id) ?? { sent: 0, cap: 0 };
    sentTodayBySender.set(id, { sent: held.sent + num(row.connections_sent), cap: Math.max(held.cap, num(row.daily_limit)) });
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
        // Senders on this campaign who have sent something today. A sender can work several campaigns,
        // so this is the sender's day, not this campaign's share of it.
        sendingToday: senderIds
          .map((id) => ({ name: senderNameById.get(id) ?? "", ...(sentTodayBySender.get(id) ?? { sent: 0, cap: 0 }) }))
          .filter((sender) => sender.name && sender.sent > 0),
        totalLeads: leads,
        leadsPending: pending,
        // Days of sending left: what is still queued over what this campaign's senders can send in a day,
        // the same arithmetic as the analytics page (each sender works the campaign up to its daily cap).
        daysLeft: pending > 0 && senderIds.length ? Math.ceil(pending / (senderIds.length * senderCap)) : pending > 0 ? null : 0,
        connectionsSent: sent,
        connectionsAccepted: accepted,
        replies: num(row.replies),
        acceptanceRate: rate(accepted, sent),
        replyRate: rate(num(row.replies), num(row.messages_started) || accepted),
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
  const leadsCount = leadsCountRaw ?? allTime.leads;

  // "Replies" is the number of leads who have replied — one conversation is one lead who replied, so it
  // is the true count of conversation threads, uncapped. This is the SAME figure the inbox shows, so the
  // two pages agree. It deliberately does NOT use the sum of each campaign's HeyReach reply count, which
  // double-counts anyone who replied across more than one campaign (that sum read 688 against 627 here).
  const repliesCount = repliesCountRaw ?? allTime.replies;
  const lifetime = windowDays === null;
  /** Leads HeyReach messaged, lifetime — the reply-rate denominator QC Command uses (accepted as fallback). */
  const messagedAll = campaignRows.reduce((total, row) => total + (num(row.messages_started) || num(row.connections_accepted)), 0);


  /*
   * The activity chart: two panels on one daily timeline, connections sent above and replies below.
   *
   * One point per day — for a week, a month, or since the first day anything happened (all time). Today
   * is included and labelled "so far" by the page, so the line ends where the data ends.
   *
   * Replies and positive replies are PEOPLE, not messages: a conversation counts once per day, positive
   * when its latest reply that day was judged positive (QC Command's definition). For a month or all
   * time the page draws them as a 7-day trailing average (`repliesAvg`, `positiveAvg`) because a client
   * with a few replies a day jumps 0 → 9 → 0 and the raw line reads as noise. The average is taken over
   * the six days *before* the window too, so the first days on the chart are not averages of a part-week.
   * The raw daily figures still travel with each point for the tooltip. Meetings count on the day booked.
   */
  const SMOOTH_DAYS = 7;
  // A week (or any short custom range) reads fine day by day; longer ranges get the 7-day average.
  const smoothing = windowDays === null || windowDays > 14;
  const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  // The chart's last day: today, or the last day of a custom range.
  const today = custom ? customEnd - DAY_MS : Date.parse(`${isoDay(now)}T00:00:00Z`);
  let span = windowDays ?? 0;
  if (windowDays === null) {
    const activity = [
      ...totals.filter((row) => num(row.connections_sent) > 0).map((row) => Date.parse(`${str(row.day).slice(0, 10)}T00:00:00Z`)),
      ...inbound.map((row) => Date.parse(str(row.sent_at))),
      ...meetings.map((row) => Date.parse(str(row.created_at) || str(row.meeting_at))),
    ].filter(Number.isFinite);
    const first = activity.length ? Date.parse(`${isoDay(Math.min(...activity))}T00:00:00Z`) : today;
    span = Math.min(400, Math.round((today - first) / DAY_MS) + 1);
  }
  const lead = smoothing ? SMOOTH_DAYS - 1 : 0;
  const dayKeys = Array.from({ length: span + lead }, (_, i) => isoDay(today - (span + lead - 1 - i) * DAY_MS));
  const dayIndex = new Map(dayKeys.map((key, i) => [key, i]));
  const daily = dayKeys.map((date) => ({ date, sent: 0, replies: 0, positive: 0, meetings: 0 }));
  for (const row of totals) {
    const i = dayIndex.get(str(row.day).slice(0, 10));
    if (i !== undefined) daily[i].sent += num(row.connections_sent);
  }
  // HeyReach reports every day in the range, zeros included, so a day with no stored row is a day QC
  // Command has not synced — not a day nothing was sent. Those are sent as null, never as 0, so the chart
  // stops where the data stops instead of diving to zero (which is how Bluvia's 50 on Oct 5 read as 0).
  const syncedThrough = totals.reduce((latest, row) => {
    const day = str(row.day).slice(0, 10);
    return day > latest ? day : latest;
  }, "");
  const syncedAt = totals.reduce((latest, row) => (str(row.refreshed_at) > latest ? str(row.refreshed_at) : latest), "");
  const latestThatDay = new Map<string, Row>();
  for (const row of inbound) {
    const at = Date.parse(str(row.sent_at));
    if (!Number.isFinite(at)) continue;
    const key = isoDay(at);
    if (!dayIndex.has(key)) continue;
    const id = `${key}|${str(row.conversation_id)}`;
    const held = latestThatDay.get(id);
    if (!held || at > Date.parse(str(held.sent_at))) latestThatDay.set(id, row);
  }
  for (const [id, row] of latestThatDay) {
    const i = dayIndex.get(id.slice(0, id.indexOf("|")))!;
    daily[i].replies += 1;
    if (str(row.sentiment).toLowerCase() === "positive") daily[i].positive += 1;
  }
  for (const row of meetings) {
    const at = Date.parse(str(row.created_at) || str(row.meeting_at));
    const i = Number.isFinite(at) ? dayIndex.get(isoDay(at)) : undefined;
    if (i !== undefined) daily[i].meetings += 1;
  }
  const trailing = (key: "replies" | "positive", i: number) => {
    const window = daily.slice(Math.max(0, i - SMOOTH_DAYS + 1), i + 1);
    return Math.round((window.reduce((total, day) => total + day[key], 0) / window.length) * 10) / 10;
  };
  const activityPoints = daily.slice(lead).map((day, j) => ({
    ...day,
    sent: syncedThrough && day.date > syncedThrough ? null : day.sent,
    repliesAvg: smoothing ? trailing("replies", j + lead) : day.replies,
    positiveAvg: smoothing ? trailing("positive", j + lead) : day.positive,
  }));

  /**
   * The reply calendar: every day of the current calendar month, whatever range the page is showing.
   *
   * Counted exactly like the chart above (a person once per day, positive by their latest reply that
   * day; meetings on the day booked), so a day on the calendar and the same day on the chart agree.
   * Days after today are sent as `future` so the page can draw them as empty slots rather than zeros.
   * The streak runs back from today across month boundaries: consecutive days with at least one reply.
   */
  const calendar = (() => {
    const todayKey = isoDay(now);
    const year = new Date(now).getUTCFullYear(), month = new Date(now).getUTCMonth();
    const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const days = Array.from({ length }, (_, i) => {
      const date = isoDay(Date.UTC(year, month, i + 1));
      return { date, replies: 0, positive: 0, meetings: 0, future: date > todayKey };
    });
    const index = new Map(days.map((day, i) => [day.date, i]));
    const latest = new Map<string, Row>();
    const replyDays = new Set<string>();
    for (const row of inbound) {
      const at = Date.parse(str(row.sent_at));
      if (!Number.isFinite(at)) continue;
      const key = isoDay(at);
      replyDays.add(key);
      if (!index.has(key)) continue;
      const id = `${key}|${str(row.conversation_id)}`;
      const held = latest.get(id);
      if (!held || at > Date.parse(str(held.sent_at))) latest.set(id, row);
    }
    for (const [id, row] of latest) {
      const day = days[index.get(id.slice(0, id.indexOf("|")))!];
      day.replies += 1;
      if (str(row.sentiment).toLowerCase() === "positive") day.positive += 1;
    }
    for (const row of meetings) {
      const at = Date.parse(str(row.created_at) || str(row.meeting_at));
      const i = Number.isFinite(at) ? index.get(isoDay(at)) : undefined;
      if (i !== undefined) days[i].meetings += 1;
    }
    // Today with no reply yet does not break the streak; it just has not been earned yet.
    let streak = 0;
    let cursor = Date.parse(`${todayKey}T00:00:00Z`);
    if (!replyDays.has(todayKey)) cursor -= DAY_MS;
    while (replyDays.has(isoDay(cursor))) { streak += 1; cursor -= DAY_MS; }
    return { month: isoDay(Date.UTC(year, month, 1)).slice(0, 7), today: todayKey, days, streak };
  })();

  return {
    calendar,
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
    window: lifetime ? {
      // All time is the whole engagement, so it is told with the lifetime totals the tiles and the funnel
      // on the same screen use. Summing the daily rows instead read 3,779 reached beside a tile saying
      // 5,617 — the daily series only starts when collection did, not when the engagement did.
      days: windowDays,
      reached: allTime.reached,
      accepted: allTime.accepted,
      replies: repliesCount,
      scored: scored30.length,
      positive: positiveAllTime,
      positiveRate: rate(positive30, scored30.length),
      acceptanceRate: Math.min(100, rate(allTime.accepted, allTime.reached)),
      // Lifetime reply rate is HeyReach's definition, as QC Command and the analytics page show it:
      // replies over leads messaged. The figures behind it are sent so the "n of m" names them.
      replyRate: Math.min(100, rate(allTime.replies, messagedAll)),
      replyPart: allTime.replies,
      replyOf: messagedAll,
      previousReached: 0,
      previousReplies: 0,
      previousAccepted: 0,
    } : {
      days: windowDays,
      reached: reached30,
      accepted: accepted30,
      replies: replies30.length,
      scored: scored30.length,
      positive: positive30,
      positiveRate: rate(positive30, scored30.length),
      // Both rates are out of the people we reached out to in the window, and clamped at 100%. Dividing
      // the replies received this week by the connections *accepted* this week (the intuitive "reply
      // rate") is wrong on a rolling window: a reply this week can come from someone who accepted weeks
      // ago, so that ratio drifts past 100% (107 replies over 104 accepts = 103%, which is nonsense).
      // Measuring both against "reached" keeps them comparable and always ≤ 100%.
      acceptanceRate: Math.min(100, rate(accepted30, reached30)),
      replyRate: Math.min(100, rate(linkedinReplies30, reached30)),
      // The previous window, so the briefing can say whether this one was better.
      previousReached: reachedPrev,
      previousReplies: repliesPrev,
      previousAccepted: acceptedPrev,
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
    activity: { smoothed: smoothing, points: activityPoints },
    /** The last day HeyReach's daily figures were synced for, and when — so the page can say when it is behind. */
    // Behind when the newest synced day is older than yesterday (today's row can lag a few hours).
    sync: { through: syncedThrough || null, at: syncedAt || null, stale: Boolean(syncedThrough) && syncedThrough < isoDay(now - DAY_MS) },
    /** For the tiles that link into the other tabs. */
    leadsTotal: leadsCount,
    /** Every connection request sent across all campaigns — people actually reached out to. */
    reachedTotal: allTime.reached,
    repliesTotal: repliesCount,
    // A staff override wins; otherwise the count of meetings QC Command knows about.
    meetingsBooked: overrideRows[0] ? num(overrideRows[0].meetings_booked) : meetings.length,
    meetingsBookedAuto: meetings.length,
    meetingsOverridden: Boolean(overrideRows[0]),
    canEditMeetings: session.role === "staff",
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
