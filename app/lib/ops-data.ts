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
import { num, scopedRows, str } from "./db";
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
};

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
    };
  });
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
