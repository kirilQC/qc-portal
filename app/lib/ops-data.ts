// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * The operational picture across every client: what is configured, and what is still breathing.
 *
 * ── Why this is a staff-only module ─────────────────────────────────────────────────────────────
 * Everything here is cross-client by nature — the point is to see fifteen clients at once and spot the
 * one that stopped syncing. There is no version of that a client should be able to load, so nothing in
 * this file is reachable without a staff session and the routes above it check the role before calling
 * in. It reads through `scopedRows` with a staff session (unscoped by definition) rather than inventing
 * a second way to the database.
 *
 * ── What "breathing" means ──────────────────────────────────────────────────────────────────────
 * A client is healthy when data arrived recently. Three separate clocks say so, and they fail
 * independently, which is why all three are shown rather than reduced to one light:
 *   · `last_webhook_received_at` — HeyReach pushing replies in as they happen
 *   · `last_successful_poll_at`  — the worker pulling, which covers anything the webhook missed
 *   · `last_reconciled_at`       — the slower sweep that repairs gaps
 * A webhook can stop while polling still works, and the numbers stay almost right for a day before
 * anybody notices. Showing the three separately is the difference between finding that in an hour and
 * finding it in a week.
 */
import { adminRows, num, scopedRows, str } from "./db";
import type { Session } from "./session";

/**
 * The staleness thresholds, taken verbatim from Reply Radar's `/api/heartbeat`.
 *
 * Copied rather than chosen, and worth being explicit about why: two tools that disagree about whether
 * a client is healthy are worse than one tool. If Reply Radar says Willow is fine and this says Willow
 * is dead, the honest reading is that the monitoring is broken, and nobody trusts either screen again.
 *
 * They differ by an order of magnitude because they measure different promises. A poll is supposed to
 * happen every hour, so an hour of silence is already wrong. A webhook only fires when a human replies,
 * so a quiet week is unremarkable for a small campaign and only becomes evidence after that.
 */
const POLL_FRESH_SECONDS = 60 * 60; // an hour
const WEBHOOK_FRESH_SECONDS = 7 * 24 * 60 * 60; // a week
/** The worker is fresh if it has written a sync run inside this window. Reply Radar's own threshold. */
const WORKER_FRESH_SECONDS = 300; // five minutes
/** How stale the last in-window Granola heartbeat may be before the poll is called down. Same as RR. */
const GRANOLA_DOWN_SECONDS = 6 * 60 * 60;
/*
 * Per-stream verdict thresholds.
 *
 * The two HeyReach streams are judged differently on purpose, because they behave differently. Campaign
 * stats are pulled on a fixed schedule, so a clock over an hour is a fault — full stop. Replies arrive
 * whenever a prospect happens to answer, which for a low-volume client can be once a week, so a quiet
 * webhook is a soft "watch" for a day and only a fault after a long silence. The reconcile sweep is a
 * slower safety net, judged loosest of all.
 */
const STATS_OK_SECONDS = 60 * 60;          // a poll older than an hour is broken
const REPLIES_WATCH_SECONDS = 24 * 60 * 60; // quiet for a day → watch
const REPLIES_BAD_SECONDS = 7 * 24 * 60 * 60; // silent for a week → stalled
const RECONCILE_OK_SECONDS = 6 * 60 * 60;
const RECONCILE_WATCH_SECONDS = 24 * 60 * 60;

/** The Granola poll window: 5am–8pm Eastern, where the team and the calls are. */
const GRANOLA_TIMEZONE = "America/New_York";
const GRANOLA_WINDOW_START_MINUTE = 5 * 60;
const GRANOLA_WINDOW_END_MINUTE = 20 * 60;

/**
 * `missing` outranks any staleness verdict: a client with no HeyReach key is not a client whose data
 * stopped arriving, it is a client whose data was never plumbed in, and the fix is a different one.
 */
export type Health = "healthy" | "attention" | "missing";

export type ClientOps = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  accentColor: string | null;

  // Configuration, as set in Reply Radar.
  timezone: string;
  heyreachConnected: boolean;
  crmProvider: string | null;
  crmLastSyncedAt: string | null;
  airtableBaseId: string | null;
  websiteUrl: string | null;
  brainFolder: string | null;
  slackInternalChannelId: string | null;
  slackExternalChannelId: string | null;
  morningBriefEnabled: boolean;
  callAnalysisEnabled: boolean;
  eowReportEnabled: boolean;
  onboardingStatus: string | null;

  // The three clocks, and the verdict drawn from the newest of them.
  lastWebhookAt: string | null;
  lastPollAt: string | null;
  lastReconciledAt: string | null;
  /** Each clock judged on its own threshold, so a page can say *which* one stopped. */
  webhookHealthy: boolean;
  pollHealthy: boolean;
  health: Health;

  // What the worker has been doing lately.
  lastRun: { source: string; runType: string; status: string; finishedAt: string | null; error: string | null } | null;
  failedRuns24h: number;
  webhookEvents24h: number;
  webhookFailures24h: number;

  // Volume, so a silent client with no campaigns is not read as a broken one.
  campaigns: number;
  conversations: number;

  /*
   * The two HeyReach streams and the reconcile sweep, each turned into a verdict a person can read
   * without knowing the thresholds — "3m ago" means nothing on its own, "current" means something.
   */
  streams: {
    replies: StreamVerdict;
    stats: StreamVerdict;
    reconcile: StreamVerdict;
  };
  /** One word for the whole client, and the level that drives its colour and its place in the sort. */
  verdictLevel: "ok" | "watch" | "stalled" | "missing";
  verdictWord: string;
};

/** One stream's freshness, said in a word. `idle` is "not applicable", not "broken". */
export type StreamVerdict = { level: "ok" | "watch" | "stalled" | "idle"; ageSeconds: number | null; note: string };

/** Seconds since an ISO timestamp, or null when there is no timestamp to measure from. */
const secondsSince = (iso: string | null): number | null => {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return (Date.now() - then) / 1000;
};

const fresherThan = (iso: string | null, limit: number): boolean => {
  const age = secondsSince(iso);
  return age !== null && age <= limit;
};

/**
 * Every client, with its configuration and its heartbeats.
 *
 * Five reads, run concurrently and stitched in memory rather than asked for per client — fifteen
 * clients times five sequential round trips is a page that takes ten seconds to draw.
 */
export async function listClientOps(session: Session): Promise<ClientOps[]> {
  if (session.role !== "staff") throw new Error("The operational view is staff-only.");

  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();

  const [workspaces, runs, webhooks, campaigns, conversations] = await Promise.all([
    scopedRows(session, "rr_workspaces", {
      select:
        "id,name,slug,logo_url,accent_color,timezone,website_url,brain_folder,airtable_base_id,crm_provider,crm_last_synced_at,slack_internal_channel_id,slack_external_channel_id,morning_brief_enabled,call_analysis_enabled,eow_report_enabled,onboarding_status,heyreach_api_key_ciphertext,last_webhook_received_at,last_successful_poll_at,last_reconciled_at",
      order: "name.asc",
    }),
    scopedRows(session, "rr_sync_runs", {
      select: "workspace_id,source,run_type,status,started_at,finished_at,error_text",
      order: "started_at.desc",
      limit: "600",
    }),
    scopedRows(session, "rr_webhook_events", {
      select: "workspace_id,status,received_at",
      received_at: `gte.${dayAgo}`,
      limit: "3000",
    }),
    scopedRows(session, "rr_campaign_stats", { select: "workspace_id", limit: "5000" }),
    scopedRows(session, "rr_conversations", { select: "workspace_id", limit: "20000" }),
  ]);

  /** Tallies keyed by workspace, so each client's numbers are one map lookup rather than a filter. */
  const tally = <T>(rows: Record<string, unknown>[], pick: (row: Record<string, unknown>) => T) => {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      const key = str(row.workspace_id);
      if (!key) continue;
      const list = map.get(key);
      if (list) list.push(pick(row));
      else map.set(key, [pick(row)]);
    }
    return map;
  };

  const runsBy = tally(runs, (row) => row);
  const hooksBy = tally(webhooks, (row) => str(row.status));
  const campaignsBy = tally(campaigns, () => 1);
  const conversationsBy = tally(conversations, () => 1);

  return workspaces.map((row) => {
    const id = str(row.id);

    const lastWebhookAt = row.last_webhook_received_at ? str(row.last_webhook_received_at) : null;
    const lastPollAt = row.last_successful_poll_at ? str(row.last_successful_poll_at) : null;
    const lastReconciledAt = row.last_reconciled_at ? str(row.last_reconciled_at) : null;

    // Reply Radar's rule, reproduced exactly: a missing key is a different problem from a stale clock,
    // and it is checked first because there is no point reporting silence on a client never plumbed in.
    const heyreachConnected = Boolean(str(row.heyreach_api_key_ciphertext));
    const webhookHealthy = fresherThan(lastWebhookAt, WEBHOOK_FRESH_SECONDS);
    const pollHealthy = fresherThan(lastPollAt, POLL_FRESH_SECONDS);
    const health: Health = !heyreachConnected
      ? "missing"
      : webhookHealthy && pollHealthy
        ? "healthy"
        : "attention";

    const mine = (runsBy.get(id) ?? []) as Record<string, unknown>[];
    const newest = mine[0];
    const hookStatuses = hooksBy.get(id) ?? [];

    // ── The three streams, as verdicts ──────────────────────────────────────────────────────────
    const repliesAge = secondsSince(lastWebhookAt);
    const statsAge = secondsSince(lastPollAt);
    const reconcileAge = secondsSince(lastReconciledAt);

    const replies: StreamVerdict = !heyreachConnected
      ? { level: "idle", ageSeconds: null, note: "not connected" }
      : repliesAge === null
        ? { level: "watch", ageSeconds: null, note: "no reply received yet" }
        : repliesAge <= REPLIES_WATCH_SECONDS
          ? { level: "ok", ageSeconds: repliesAge, note: "flowing" }
          : repliesAge <= REPLIES_BAD_SECONDS
            ? { level: "watch", ageSeconds: repliesAge, note: "quiet — may be normal for this client" }
            : { level: "stalled", ageSeconds: repliesAge, note: "silent for over a week" };

    const stats: StreamVerdict = !heyreachConnected
      ? { level: "idle", ageSeconds: null, note: "not connected" }
      : statsAge === null
        ? { level: "stalled", ageSeconds: null, note: "never polled" }
        : statsAge <= STATS_OK_SECONDS
          ? { level: "ok", ageSeconds: statsAge, note: "current" }
          : { level: "stalled", ageSeconds: statsAge, note: "poll is over an hour late" };

    const reconcile: StreamVerdict = reconcileAge === null
      ? { level: "idle", ageSeconds: null, note: "not run yet" }
      : reconcileAge <= RECONCILE_OK_SECONDS
        ? { level: "ok", ageSeconds: reconcileAge, note: "gaps checked" }
        : reconcileAge <= RECONCILE_WATCH_SECONDS
          ? { level: "watch", ageSeconds: reconcileAge, note: "check is due" }
          : { level: "stalled", ageSeconds: reconcileAge, note: "no gap check in over a day" };

    // The client's one word: stats stalled is the loudest (it means the schedule broke), then replies
    // stalled, then a watch, else all current. A client never plumbed in is its own separate state.
    const verdictLevel: ClientOps["verdictLevel"] = !heyreachConnected
      ? "missing"
      : stats.level === "stalled"
        ? "stalled"
        : replies.level === "stalled"
          ? "stalled"
          : replies.level === "watch" || reconcile.level === "stalled"
            ? "watch"
            : "ok";
    const verdictWord =
      verdictLevel === "missing" ? "Not connected"
      : stats.level === "stalled" ? "Stats stalled"
      : replies.level === "stalled" ? "Replies stalled"
      : verdictLevel === "watch" ? "Watch"
      : "All current";

    return {
      id,
      name: str(row.name),
      slug: str(row.slug),
      logoUrl: row.logo_url ? str(row.logo_url) : null,
      accentColor: row.accent_color ? str(row.accent_color) : null,

      timezone: str(row.timezone) || "—",
      // The key itself is never sent to the browser, only whether one is present. Nothing on this
      // screen needs its value, and a secret that never reaches a browser cannot leak from one.
      heyreachConnected,
      crmProvider: row.crm_provider ? str(row.crm_provider) : null,
      crmLastSyncedAt: row.crm_last_synced_at ? str(row.crm_last_synced_at) : null,
      airtableBaseId: row.airtable_base_id ? str(row.airtable_base_id) : null,
      websiteUrl: row.website_url ? str(row.website_url) : null,
      brainFolder: row.brain_folder ? str(row.brain_folder) : null,
      slackInternalChannelId: row.slack_internal_channel_id ? str(row.slack_internal_channel_id) : null,
      slackExternalChannelId: row.slack_external_channel_id ? str(row.slack_external_channel_id) : null,
      morningBriefEnabled: row.morning_brief_enabled === true,
      callAnalysisEnabled: row.call_analysis_enabled === true,
      eowReportEnabled: row.eow_report_enabled === true,
      onboardingStatus: row.onboarding_status ? str(row.onboarding_status) : null,

      lastWebhookAt,
      lastPollAt,
      lastReconciledAt,
      webhookHealthy,
      pollHealthy,
      health,

      lastRun: newest
        ? {
            source: str(newest.source),
            runType: str(newest.run_type),
            status: str(newest.status),
            finishedAt: newest.finished_at ? str(newest.finished_at) : null,
            error: newest.error_text ? str(newest.error_text) : null,
          }
        : null,
      failedRuns24h: mine.filter(
        (run) => str(run.status) === "error" && Date.parse(str(run.started_at)) >= Date.parse(dayAgo),
      ).length,
      webhookEvents24h: hookStatuses.length,
      webhookFailures24h: hookStatuses.filter((status) => status === "error" || status === "failed").length,

      campaigns: (campaignsBy.get(id) ?? []).length,
      conversations: (conversationsBy.get(id) ?? []).length,

      streams: { replies, stats, reconcile },
      verdictLevel,
      verdictWord,
    };
  });
}

/**
 * The one honest headline, computed from every client and the worker.
 *
 * The worker dominates: if it has stopped, every clock on the page is frozen at its last value and a
 * frozen "3m ago" looks healthy, so the verdict must go red on the worker's staleness before any
 * client's — nothing else can be trusted while the worker is down. Below that, a single stalled client
 * turns it red; a watch keeps it green but is mentioned.
 */
export type Verdict = {
  level: "good" | "bad";
  headline: string;
  detail: string;
  /** The clients that are stalled or watched, worst first — what an alert would name. */
  flagged: { name: string; slug: string; word: string; level: ClientOps["verdictLevel"] }[];
};

export function healthVerdict(clients: ClientOps[], worker: WorkerHeartbeat): Verdict {
  const connected = clients.filter((c) => c.heyreachConnected);
  const stalled = clients.filter((c) => c.verdictLevel === "stalled");
  const watched = clients.filter((c) => c.verdictLevel === "watch");
  const flagged = [...stalled, ...watched].map((c) => ({ name: c.name, slug: c.slug, word: c.verdictWord, level: c.verdictLevel }));

  if (worker.status !== "healthy") {
    return {
      level: "bad",
      headline: worker.status === "never"
        ? "No sign of the Reply Radar worker"
        : "The Reply Radar worker has stopped — data is frozen",
      detail: worker.status === "never"
        ? "Nothing has ever written to the sync log. Until the worker runs, nothing on this portal is live."
        : `Its last heartbeat was ${describeAge(worker.ageSeconds)} ago. Every client's data is frozen at its last value until it resumes.`,
      flagged,
    };
  }

  if (stalled.length > 0) {
    const first = stalled[0];
    return {
      level: "bad",
      headline: stalled.length === 1
        ? `${first.name}: ${first.verdictWord.toLowerCase()}`
        : `${stalled.length} clients have stopped receiving data`,
      detail: stalled.length === 1
        ? `${describeStall(first)} ${connected.length - 1} other connected client${connected.length - 1 === 1 ? " is" : "s are"} fine.`
        : stalled.map((c) => c.name).join(", ") + " — open each below for what stopped.",
      flagged,
    };
  }

  return {
    level: "good",
    headline: "Everything is live",
    detail: `${connected.length} client${connected.length === 1 ? "" : "s"} receiving HeyReach data · worker wrote ${describeAge(worker.ageSeconds)} ago${watched.length ? ` · ${watched.length} to keep an eye on` : " · nothing stale"}.`,
    flagged,
  };
}

function describeStall(c: { streams: ClientOps["streams"]; verdictWord: string }): string {
  if (c.streams.stats.level === "stalled") return `Campaign stats stopped updating ${describeAge(c.streams.stats.ageSeconds)} ago.`;
  if (c.streams.replies.level === "stalled") return `No reply has arrived for ${describeAge(c.streams.replies.ageSeconds)}.`;
  return "A data stream has stopped.";
}

function describeAge(seconds: number | null): string {
  if (seconds === null) return "an unknown time";
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * The sync-run history, for the chart that shows data actually arriving over time.
 *
 * Bucketed by hour rather than returned raw: six hundred rows is a wall of text, and the question this
 * answers is "has anything been landing", which a shape answers better than a list.
 */
export async function recentRuns(session: Session, hours = 48) {
  if (session.role !== "staff") throw new Error("The operational view is staff-only.");
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const rows = await scopedRows(session, "rr_sync_runs", {
    select: "workspace_id,source,run_type,status,started_at,finished_at,records_seen,records_written,error_text",
    started_at: `gte.${since}`,
    order: "started_at.desc",
    limit: "2000",
  });

  const buckets = new Map<string, { hour: string; ok: number; error: number; written: number }>();
  for (const row of rows) {
    const started = str(row.started_at);
    if (!started) continue;
    const hour = `${started.slice(0, 13)}:00`;
    const bucket = buckets.get(hour) ?? { hour, ok: 0, error: 0, written: 0 };
    if (str(row.status) === "error") bucket.error += 1;
    else bucket.ok += 1;
    bucket.written += num(row.records_written);
    buckets.set(hour, bucket);
  }

  return {
    series: [...buckets.values()].sort((a, b) => a.hour.localeCompare(b.hour)),
    latest: rows.slice(0, 60).map((row) => ({
      workspaceId: str(row.workspace_id),
      source: str(row.source),
      runType: str(row.run_type),
      status: str(row.status),
      startedAt: str(row.started_at),
      finishedAt: row.finished_at ? str(row.finished_at) : null,
      recordsSeen: num(row.records_seen),
      recordsWritten: num(row.records_written),
      error: row.error_text ? str(row.error_text) : null,
    })),
  };
}

/* ── The tether itself ──────────────────────────────────────────────────────────────────────────
 *
 * The per-client table below answers "is each client still receiving data". These next three answer
 * the question the whole page exists for: is the pipe between Reply Radar and this portal actually
 * moving, right now.
 *
 * ── An honest word on what the portal can and cannot see ────────────────────────────────────────
 * Reply Radar's own health page checks the environment of the machine it runs on — is the Anthropic
 * key set, is the worker URL configured, is Airtable reachable. This portal runs on a different
 * machine and does not have those secrets, so it cannot check them and does not pretend to. What it
 * shares with Reply Radar is the one thing that matters here: the same Supabase database. So every
 * check on this page is derived from that shared database — the worker's own output, the Granola
 * poll's own heartbeats — which is a stronger signal than an env var anyway. An env var being present
 * says a thing was configured; a fresh row says it is working.
 */

/** Local minutes since midnight in a zone, read out of Intl so the window follows daylight saving. */
function localMinutes(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return (hour % 24) * 60 + minute;
}

/**
 * The four states the Granola heartbeat can be in — copied verbatim from Reply Radar's own logic so the
 * two pages never disagree about whether Granola is down.
 *
 *   idle     — outside the 5am–8pm window; not polling on purpose, so nothing is wrong.
 *   starting — inside the window but no heartbeat stored yet; the first poll is still to come.
 *   ok       — inside the window and the last heartbeat is fresher than six hours.
 *   down     — inside the window and the last heartbeat is older than six hours: the poll has stalled.
 */
type GranolaState = "idle" | "starting" | "ok" | "down";
function granolaState(lastCheckedAt: string | null): { state: GranolaState; inWindow: boolean; ageSeconds: number | null } {
  const now = new Date();
  const minutes = localMinutes(now, GRANOLA_TIMEZONE);
  const inWindow = minutes >= GRANOLA_WINDOW_START_MINUTE && minutes <= GRANOLA_WINDOW_END_MINUTE;
  const ageSeconds = secondsSince(lastCheckedAt);
  if (!inWindow) return { state: "idle", inWindow, ageSeconds };
  if (ageSeconds === null) return { state: "starting", inWindow, ageSeconds };
  return { state: ageSeconds > GRANOLA_DOWN_SECONDS ? "down" : "ok", inWindow, ageSeconds };
}

export type Dependency = {
  id: string;
  label: string;
  status: "healthy" | "attention" | "down" | "idle";
  detail: string;
  ageSeconds: number | null;
  latencyMs: number | null;
  /** What this check is actually derived from, said plainly, because the honesty is the point here. */
  derivedFrom: string;
};

export type WorkerHeartbeat = {
  status: "healthy" | "stale" | "never";
  ageSeconds: number | null;
  lastRunAt: string | null;
  lastFinishedAt: string | null;
  recordsWritten: number;
  recordsSeen: number;
  source: string | null;
  runType: string | null;
  error: string | null;
  recentRuns: { workspaceId: string; source: string; runType: string; status: string; startedAt: string; recordsWritten: number; error: string | null }[];
};

export type GranolaHeartbeat = {
  state: GranolaState;
  inWindow: boolean;
  ageSeconds: number | null;
  lastCheckedAt: string | null;
  callsFound: number;
  clientsChecked: number;
  clients: { slug: string; name: string; title: string | null; ageDays: number | null; isNew: boolean }[];
  recentChecks: { checkedAt: string | null; callsFound: number; clientsChecked: number }[];
};

export type SystemHealth = {
  dependencies: Dependency[];
  worker: WorkerHeartbeat;
  granola: GranolaHeartbeat;
};

/**
 * The whole tether, in one read fan-out.
 *
 * The three checks share their inputs — the newest sync run answers both "is Supabase reachable" (the
 * read returned) and "is the worker alive" (something wrote it) — so they are gathered together and the
 * verdicts drawn from them in memory.
 */
export async function systemHealth(session: Session): Promise<SystemHealth> {
  if (session.role !== "staff") throw new Error("The operational view is staff-only.");

  const startedProbe = Date.now();
  const [syncRows, granolaRows] = await Promise.all([
    // The newest runs across every client, for both the worker verdict and the Supabase latency probe.
    scopedRows(session, "rr_sync_runs", {
      select: "workspace_id,source,run_type,status,started_at,finished_at,records_seen,records_written,error_text",
      order: "started_at.desc",
      limit: "40",
    }),
    // A STAFF_ONLY table, so it goes through adminRows — the application's own rows, not a tenant's.
    adminRows("rr_granola_heartbeats", { select: "*", order: "checked_at.desc", limit: "12" }).catch(() => []),
  ]);
  const supabaseLatencyMs = Date.now() - startedProbe;

  // ── The worker ────────────────────────────────────────────────────────────────────────────────
  // Identified the same way Reply Radar identifies it: a heartbeat run the worker writes on every tick.
  const workerRun =
    syncRows.find((row) => str(row.source) === "render-worker-heartbeat" || str(row.run_type) === "heartbeat") ??
    syncRows[0] ??
    null;
  const workerAge = workerRun ? secondsSince(str(workerRun.started_at)) : null;
  const worker: WorkerHeartbeat = {
    status: workerAge === null ? "never" : workerAge <= WORKER_FRESH_SECONDS ? "healthy" : "stale",
    ageSeconds: workerAge,
    lastRunAt: workerRun ? str(workerRun.started_at) : null,
    lastFinishedAt: workerRun?.finished_at ? str(workerRun.finished_at) : null,
    recordsWritten: workerRun ? num(workerRun.records_written) : 0,
    recordsSeen: workerRun ? num(workerRun.records_seen) : 0,
    source: workerRun ? str(workerRun.source) : null,
    runType: workerRun ? str(workerRun.run_type) : null,
    error: workerRun?.error_text ? str(workerRun.error_text) : null,
    recentRuns: syncRows.slice(0, 15).map((row) => ({
      workspaceId: str(row.workspace_id),
      source: str(row.source),
      runType: str(row.run_type),
      status: str(row.status),
      startedAt: str(row.started_at),
      recordsWritten: num(row.records_written),
      error: row.error_text ? str(row.error_text) : null,
    })),
  };

  // ── Granola ───────────────────────────────────────────────────────────────────────────────────
  const latestGranola = granolaRows[0] ?? null;
  const gState = granolaState(latestGranola?.checked_at ? str(latestGranola.checked_at) : null);
  const granolaClients = Array.isArray(latestGranola?.clients) ? (latestGranola.clients as Record<string, unknown>[]) : [];
  const granola: GranolaHeartbeat = {
    state: gState.state,
    inWindow: gState.inWindow,
    ageSeconds: gState.ageSeconds,
    lastCheckedAt: latestGranola?.checked_at ? str(latestGranola.checked_at) : null,
    callsFound: num(latestGranola?.calls_found),
    clientsChecked: num(latestGranola?.clients_checked) || granolaClients.length,
    clients: granolaClients.map((client) => ({
      slug: str(client.slug),
      name: str(client.name) || str(client.slug),
      title: client.title ? str(client.title) : null,
      ageDays: client.age_days == null ? null : num(client.age_days),
      isNew: Boolean(client.is_new),
    })),
    recentChecks: granolaRows.map((row) => ({
      checkedAt: row.checked_at ? str(row.checked_at) : null,
      callsFound: num(row.calls_found),
      clientsChecked: num(row.clients_checked),
    })),
  };

  // ── The dependency strip ────────────────────────────────────────────────────────────────────────
  const dependencies: Dependency[] = [
    {
      id: "supabase",
      label: "Supabase database",
      status: "healthy", // the reads above returned, or this function would have thrown
      detail: `Read returned in ${supabaseLatencyMs} ms.`,
      ageSeconds: null,
      latencyMs: supabaseLatencyMs,
      derivedFrom: "This portal's own live read of the shared database.",
    },
    {
      id: "worker",
      label: "Reply Radar worker",
      status: worker.status === "healthy" ? "healthy" : worker.status === "never" ? "down" : "attention",
      detail:
        worker.status === "healthy"
          ? `Last heartbeat ${formatAge(worker.ageSeconds)} ago.`
          : worker.status === "never"
            ? "No sync run has ever been recorded."
            : `Last heartbeat ${formatAge(worker.ageSeconds)} ago — over the five-minute ceiling.`,
      ageSeconds: worker.ageSeconds,
      latencyMs: null,
      derivedFrom: "The freshness of the newest row the worker wrote to rr_sync_runs.",
    },
    {
      id: "granola",
      label: "Granola call poll",
      status: gState.state === "down" ? "down" : gState.state === "idle" ? "idle" : gState.state === "starting" ? "attention" : "healthy",
      detail:
        gState.state === "down"
          ? "No heartbeat for over six hours while the window is open."
          : gState.state === "idle"
            ? "Outside the 5am–8pm window — not polling, by design."
            : gState.state === "starting"
              ? "In the window; waiting for the first heartbeat."
              : `Last poll found ${granola.callsFound} call(s) across ${granola.clientsChecked} client(s).`,
      ageSeconds: gState.ageSeconds,
      latencyMs: null,
      derivedFrom: "The newest row in rr_granola_heartbeats, judged against the poll window.",
    },
  ];

  return { dependencies, worker, granola };
}

/** "3m", "2h 14m", "1d 4h" — an age, compact, for a status line. */
function formatAge(seconds: number | null): string {
  if (seconds === null) return "never";
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
