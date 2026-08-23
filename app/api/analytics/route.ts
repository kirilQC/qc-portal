// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * One client's analytics, shaped exactly as Reply Radar shapes them.
 *
 * ── Why every formula is copied rather than chosen ──────────────────────────────────────────────
 * This page exists so a client can see the same figures QC sees. If the portal divided replies by
 * requests sent while Reply Radar divided by requests accepted, the two screens would disagree by
 * several points and every conversation would become an argument about which one to believe. So the
 * conventions are lifted verbatim:
 *
 *   · acceptance    = accepted ÷ sent
 *   · reply rate    = replies ÷ **accepted** — nobody can reply to a request never accepted
 *   · positive rate = positive replies ÷ accepted
 *   · days left     = leads still to contact ÷ (senders × the daily cap)
 *   · the averages  = the unweighted mean of the per-campaign rates, not the pooled total
 *
 * ── Why sentiment is counted here and not read ──────────────────────────────────────────────────
 * Whether a reply was positive is a judgement this system made and stored on the message, so it is
 * counted from the messages. The two fields are lifted out of the JSON by PostgREST rather than
 * downloading `raw_data` whole — selecting the entire HeyReach payload to read one string out of it is
 * how Reply Radar's own analytics route once came to move megabytes to count sentiments.
 */
import { NextResponse } from "next/server";
import { resolveScope } from "../../lib/auth-context";
import { num, scopedByConversation, scopedRows, str, type Row } from "../../lib/db";
import type { Session } from "../../lib/session";

export const maxDuration = 60;

/** The fortnight the charts cover. */
const WINDOW_DAYS = 14;
/** Used only when HeyReach reports no per-sender cap at all. */
const FALLBACK_CAP = 25;

/** The last N calendar days as `YYYY-MM-DD`, oldest first. */
function dayKeys(count: number): string[] {
  const days: string[] = [];
  const today = new Date();
  for (let back = count - 1; back >= 0; back -= 1) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - back));
    days.push(date.toISOString().slice(0, 10));
  }
  return days;
}

const label = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "numeric", day: "numeric", timeZone: "UTC" });

export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("client");

  let scope;
  try {
    scope = await resolveScope(slug);
  } catch {
    return NextResponse.json({ ok: false, status: "no_session" }, { status: 401 });
  }
  const { session, workspaceId } = scope;
  if (!workspaceId) return NextResponse.json({ ok: false, status: "no_client" }, { status: 400 });

  try {
    const payload = await build(session, workspaceId);
    return NextResponse.json({ ok: true, status: "live", role: session.role, ...payload });
  } catch (error) {
    return NextResponse.json(
      { ok: false, status: "error", error: error instanceof Error ? error.message : "Analytics did not load." },
      { status: 502 },
    );
  }
}

async function build(session: Session, workspaceId: string) {
  const [workspaceRows, campaignRows, dailyRows, conversations, runs] = await Promise.all([
    scopedRows(session, "rr_workspaces", { select: "id,name,slug,logo_url,accent_color", limit: "1" }, workspaceId),
    scopedRows(
      session,
      "rr_campaign_stats",
      {
        select:
          "campaign_id,name,status,launched_at,sender_ids,total_leads,leads_pending,connections_sent,connections_accepted,replies,messages_started,sequence_steps,first_touch,follow_up,refreshed_at",
      },
      workspaceId,
    ),
    scopedRows(
      session,
      "rr_daily_stats",
      { select: "day,sender_id,sender_name,daily_limit,connections_sent,connections_accepted,replies", limit: "5000" },
      workspaceId,
    ),
    scopedRows(session, "rr_conversations", { select: "id", limit: "5000" }, workspaceId),
    scopedRows(
      session,
      "rr_sync_runs",
      { select: "status,started_at,finished_at,error_text,run_type", order: "started_at.desc", limit: "6" },
      workspaceId,
    ),
  ]);

  const workspace = workspaceRows[0];
  if (!workspace) throw new Error("That client was not found.");

  // Inbound messages, for the reply and sentiment counts. Two short strings per row, not the payload.
  const conversationIds = conversations.map((row) => str(row.id)).filter(Boolean);
  const inbound = conversationIds.length
    ? await scopedByConversation(
        session,
        "rr_messages",
        conversationIds,
        {
          select: "sent_at,sentiment:raw_data->reply_radar->>sentiment,campaign:raw_data->reply_radar->campaign->>name",
          direction: "eq.inbound",
          limit: "1000",
        },
        workspaceId,
      ).catch(() => [] as Row[])
    : [];

  const positiveByCampaign = new Map<string, number>();
  const weekAgo = Date.now() - 7 * 86_400_000;
  let replies7d = 0;
  for (const message of inbound) {
    if (Date.parse(str(message.sent_at)) >= weekAgo) replies7d += 1;
    const key = str(message.campaign).trim().toLowerCase();
    if (!key) continue;
    if (str(message.sentiment).toLowerCase() === "positive") {
      positiveByCampaign.set(key, (positiveByCampaign.get(key) ?? 0) + 1);
    }
  }

  /*
   * The per-sender daily cap, taken from what HeyReach reports rather than assumed.
   *
   * "Days of sending left" is a division by it, so a wrong value here is a wrong forecast on every
   * active campaign. The highest cap seen on the account is used, and 25 only if nothing was reported.
   */
  const caps = dailyRows.map((row) => num(row.daily_limit)).filter((value) => value > 0);
  const senderCap = caps.length ? Math.max(...caps) : FALLBACK_CAP;

  const campaigns = campaignRows.map((row) => {
    const name = str(row.name);
    const key = name.trim().toLowerCase();
    const sent = num(row.connections_sent);
    const accepted = num(row.connections_accepted);
    const replies = num(row.replies);
    const positiveReplies = positiveByCampaign.get(key) ?? 0;
    const senderIds = Array.isArray(row.sender_ids) ? row.sender_ids.map((value) => str(value)) : [];
    const pending = num(row.leads_pending);
    // Every assigned sender works the campaign in parallel to its own cap, so a day's throughput is
    // the cap times the number of senders on it.
    const dailyCapacity = senderIds.length * senderCap;

    return {
      campaignId: str(row.campaign_id),
      name,
      status: row.status ? str(row.status) : null,
      launchedAt: row.launched_at ? str(row.launched_at) : null,
      senderIds,
      totalLeads: num(row.total_leads),
      leadsPending: pending,
      connectionsSent: sent,
      connectionsAccepted: accepted,
      replies,
      positiveReplies,
      messagesStarted: num(row.messages_started),
      sequenceSteps: row.sequence_steps == null ? null : num(row.sequence_steps),
      firstTouch: row.first_touch ? str(row.first_touch) : null,
      followUp: row.follow_up ? str(row.follow_up) : null,
      acceptanceRate: sent ? (accepted / sent) * 100 : 0,
      replyRate: accepted ? (replies / accepted) * 100 : 0,
      positiveReplyRate: accepted ? (positiveReplies / accepted) * 100 : 0,
      daysLeft: pending > 0 && dailyCapacity > 0 ? Math.ceil(pending / dailyCapacity) : pending > 0 ? null : 0,
    };
  });

  // The fortnight's account-wide series. `sender_id = ''` is the client-wide row the worker stores
  // beside the per-sender ones, so the headline chart matches HeyReach's own dashboard even after a
  // sender is disconnected and its history would otherwise vanish from a sum.
  const days = dayKeys(WINDOW_DAYS);
  const totals = new Map<string, Row>();
  const senders = new Map<
    string,
    { id: string; name: string; dailyLimit: number | null; byDay: Map<string, number>; connectionsSent: number; connectionsAccepted: number }
  >();

  for (const row of dailyRows) {
    const day = str(row.day).slice(0, 10);
    const senderId = str(row.sender_id);
    if (!senderId) {
      totals.set(day, row);
      continue;
    }
    const sender = senders.get(senderId) ?? {
      id: senderId,
      name: str(row.sender_name) || `Sender ${senderId}`,
      dailyLimit: num(row.daily_limit) || null,
      byDay: new Map<string, number>(),
      connectionsSent: 0,
      connectionsAccepted: 0,
    };
    if (days.includes(day)) {
      sender.byDay.set(day, num(row.connections_sent));
      sender.connectionsSent += num(row.connections_sent);
      sender.connectionsAccepted += num(row.connections_accepted);
    }
    senders.set(senderId, sender);
  }

  const daily = days.map((day) => {
    const row = totals.get(day);
    return {
      day,
      label: label(day),
      connectionsSent: row ? num(row.connections_sent) : 0,
      connectionsAccepted: row ? num(row.connections_accepted) : 0,
      replies: row ? num(row.replies) : 0,
    };
  });

  const senderSeries = [...senders.values()]
    .filter((sender) => sender.connectionsSent > 0)
    .sort((a, b) => b.connectionsSent - a.connectionsSent)
    .map((sender) => ({
      id: sender.id,
      name: sender.name,
      dailyLimit: sender.dailyLimit,
      connectionsSent: sender.connectionsSent,
      connectionsAccepted: sender.connectionsAccepted,
      byDay: days.map((day) => sender.byDay.get(day) ?? 0),
    }));

  // When the worker last read HeyReach. Stated on the page because the figures are up to a day old,
  // and saying so is the difference between a stale number and a wrong one.
  const collectedAt = campaignRows
    .map((row) => str(row.refreshed_at))
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  const analyticsRuns = runs.filter((row) => str(row.run_type) === "analytics");
  const pending = analyticsRuns.find((row) => ["queued", "running"].includes(str(row.status).toLowerCase()));
  const settled = analyticsRuns.find((row) => !["queued", "running"].includes(str(row.status).toLowerCase()));

  return {
    workspace: {
      id: str(workspace.id),
      name: str(workspace.name),
      slug: str(workspace.slug),
      logoUrl: workspace.logo_url ? str(workspace.logo_url) : null,
      accentColor: workspace.accent_color ? str(workspace.accent_color) : null,
    },
    campaigns,
    daily,
    senders: senderSeries,
    senderCap,
    repliesSynced: inbound.length,
    replies7d,
    conversations: conversations.length,
    collectedAt,
    sync: {
      state: pending ? (str(pending.status).toLowerCase() === "running" ? "running" : "queued") : "idle",
      lastStatus: settled ? str(settled.status) : null,
      lastFinishedAt: settled?.finished_at ? str(settled.finished_at) : null,
      lastError: settled?.error_text ? str(settled.error_text) : null,
    },
  };
}
