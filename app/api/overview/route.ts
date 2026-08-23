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

export const maxDuration = 60;

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;
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
    return NextResponse.json({ ok: true, view: "client", ...(await build(session, workspaceId)) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "The overview did not load." },
      { status: 502 },
    );
  }
}

async function build(session: Session, workspaceId: string) {
  const now = Date.now();
  const windowStart = now - WINDOW_DAYS * DAY_MS;
  const previousStart = windowStart - WINDOW_DAYS * DAY_MS;

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
          select: "conversation_id,sent_at,sentiment:raw_data->reply_radar->>sentiment,campaign:raw_data->reply_radar->campaign->>name",
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
    return Math.min(BUCKETS - 1, Math.floor(((at - windowStart) / (WINDOW_DAYS * DAY_MS)) * BUCKETS));
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

  type Event = { kind: "reply" | "positive" | "launch" | "meeting"; at: string; title: string; detail: string };
  const events: Event[] = [];

  for (const conversation of conversations) {
    const message = newestReply.get(str(conversation.id));
    if (!message) continue;
    const lead = leadById.get(str(conversation.lead_id));
    if (!lead) continue;
    const name = str(lead.name) || "Someone";
    const where = [str(lead.role), str(lead.company)].filter(Boolean).join(" @ ");
    const campaign = str(message.campaign);
    const isPositive = str(message.sentiment).toLowerCase() === "positive";
    events.push({
      kind: isPositive ? "positive" : "reply",
      at: str(message.sent_at) || str(conversation.last_message_at),
      title: isPositive ? `${name} replied — positive` : `${name} replied`,
      detail: [where, campaign].filter(Boolean).join(" · "),
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

  const launchedAt = campaignRows
    .map((row) => str(row.launched_at))
    .filter(Boolean)
    .sort()[0] ?? null;

  return {
    client: {
      id: str(workspace.id),
      name: str(workspace.name),
      slug: str(workspace.slug),
      logoUrl: workspace.logo_url ? str(workspace.logo_url) : null,
      accentColor: workspace.accent_color ? str(workspace.accent_color) : null,
    },
    startedAt: launchedAt,
    window: {
      days: WINDOW_DAYS,
      reached: reached30,
      accepted: accepted30,
      replies: replies30.length,
      scored: scored30.length,
      positive: positive30,
      positiveRate: rate(positive30, scored30.length),
      acceptanceRate: rate(accepted30, reached30),
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
    bestCampaigns,
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
