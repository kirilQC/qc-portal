// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * The watchdog. This is the piece that lets you close the tab.
 *
 * A scheduled job (see vercel.json) hits this every few minutes. It computes the same verdict the health
 * page shows and does two things with it:
 *
 *   · On change — the moment the verdict goes bad, or recovers — it posts to Slack. It compares against
 *     the verdict it stored last time, so a client that has been down for an hour is not re-announced
 *     every five minutes. No news is genuinely good news.
 *
 *   · Once a day — a plain "N/N healthy" all-clear. This is the quiet hero: an alert-only system fails
 *     silently if the alerting itself breaks, because silence then looks identical to health. A daily
 *     heartbeat means the day it does not arrive is itself the warning.
 *
 * ── Why it is safe for an unauthenticated cron to build a staff view ────────────────────────────
 * The job has no session — it is a machine on a timer. So it is gated on a shared secret instead: Vercel
 * cron sends `Authorization: Bearer $CRON_SECRET`, and without a matching secret this route refuses
 * everything. Only past that gate does it construct the staff session the health reads require, and that
 * session never leaves this function.
 */
import { NextResponse } from "next/server";
import type { Session } from "../../../lib/session";
import { adminRows, adminWrite } from "../../../lib/db";
import { healthVerdict, listClientOps, systemHealth, type Verdict } from "../../../lib/ops-data";

export const maxDuration = 60;

/** The synthetic session the job runs as — staff, every client, belonging to no real user. */
const CRON_SESSION: Session = { userId: "cron:health-alert", role: "staff", workspaceId: null };

/** Whether the caller carries the cron secret. Absent secret means the watchdog is simply not armed. */
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

async function postSlack(text: string): Promise<void> {
  const webhook = process.env.HEALTH_ALERT_SLACK_WEBHOOK?.trim();
  if (!webhook) return;
  await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  }).catch(() => {});
}

/** Today's date in Eastern, so "once a day" means once per calendar day where the team is. */
function easternDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** A short signature of a verdict, so "still bad, same clients" does not re-alert. */
function signature(verdict: Verdict): string {
  return `${verdict.level}|${verdict.flagged.map((f) => `${f.slug}:${f.level}`).sort().join(",")}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 401 });
  }

  try {
    const [clients, health] = await Promise.all([listClientOps(CRON_SESSION), systemHealth(CRON_SESSION)]);
    const verdict = healthVerdict(clients, health.worker);
    const connected = clients.filter((c) => c.heyreachConnected).length;

    // The previous run's memory: what the verdict was, and when the daily digest last went out.
    const stateRows = await adminRows("qc_portal_health_state", { select: "*", id: "eq.singleton", limit: "1" }).catch(() => []);
    const state = stateRows[0] as Record<string, unknown> | undefined;
    const priorVerdict = (state?.last_verdict ?? null) as Verdict | null;
    const priorSig = priorVerdict ? signature(priorVerdict) : "";
    const lastDaily = state?.last_daily_at ? String(state.last_daily_at) : null;

    const now = new Date();
    const nowSig = signature(verdict);
    const changed = nowSig !== priorSig;
    const posted: string[] = [];

    // ── On change ─────────────────────────────────────────────────────────────────────────────────
    if (changed && priorVerdict !== null) {
      if (verdict.level === "bad") {
        await postSlack(`⚠️ *${verdict.headline}*\n${verdict.detail}`);
        posted.push("changed_bad");
      } else if (priorVerdict.level === "bad") {
        await postSlack(`✅ *Recovered* — ${verdict.detail}`);
        posted.push("recovered");
      }
    }

    // ── Daily all-clear ─────────────────────────────────────────────────────────────────────────────
    const today = easternDay(now);
    const dailyAlreadySent = lastDaily ? easternDay(new Date(lastDaily)) === today : false;
    const inDigestHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }).format(now)) === 7;
    let dailyAt = lastDaily;
    if (inDigestHour && !dailyAlreadySent) {
      const line = verdict.level === "good"
        ? `✅ *Daily health* — ${connected}/${connected} clients healthy. ${verdict.detail}`
        : `⚠️ *Daily health* — ${verdict.headline}. ${verdict.detail}`;
      await postSlack(line);
      posted.push("daily");
      dailyAt = now.toISOString();
    }

    // Remember this run for the next one, and for the nav dot to read cheaply.
    await adminWrite(
      "qc_portal_health_state",
      "POST",
      { id: "singleton", last_verdict: verdict, last_daily_at: dailyAt, updated_at: now.toISOString() },
      { on_conflict: "id" },
      ["resolution=merge-duplicates"],
    ).catch(() => {});

    return NextResponse.json({ ok: true, level: verdict.level, changed, posted, slackConfigured: Boolean(process.env.HEALTH_ALERT_SLACK_WEBHOOK) });
  } catch (error) {
    // A watchdog that fails silently is worse than none — try to say so on the channel it guards.
    await postSlack(`🔴 *QC Portal health check failed to run.* ${error instanceof Error ? error.message : "unknown error"}`);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Health check failed." }, { status: 502 });
  }
}
