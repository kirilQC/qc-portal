// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { Fragment, Suspense, useEffect, useState } from "react";
import Link from "next/link";

/**
 * Every client's configuration and heartbeats on one screen.
 *
 * ── Why the unhealthy clients are pulled to the top ─────────────────────────────────────────────
 * This page is opened for one reason: to find out whether anything has stopped. Sorted alphabetically,
 * the one client that died is a row you have to notice among fifteen that are fine — so the ordering is
 * by health, worst first, and a page that opens with nothing at the top is itself the good news.
 */
type Ops = {
  id: string; name: string; slug: string; logoUrl: string | null; accentColor: string | null;
  timezone: string; heyreachConnected: boolean; crmProvider: string | null; crmLastSyncedAt: string | null;
  airtableBaseId: string | null; websiteUrl: string | null; brainFolder: string | null;
  slackInternalChannelId: string | null; slackExternalChannelId: string | null;
  morningBriefEnabled: boolean; callAnalysisEnabled: boolean; eowReportEnabled: boolean;
  onboardingStatus: string | null;
  lastWebhookAt: string | null; lastPollAt: string | null; lastReconciledAt: string | null;
  webhookHealthy: boolean; pollHealthy: boolean; health: "healthy" | "attention" | "missing";
  lastRun: { source: string; runType: string; status: string; finishedAt: string | null; error: string | null } | null;
  failedRuns24h: number; webhookEvents24h: number; webhookFailures24h: number;
  campaigns: number; conversations: number;
};
type Runs = {
  series: { hour: string; ok: number; error: number; written: number }[];
  latest: { workspaceId: string; source: string; runType: string; status: string; startedAt: string; recordsSeen: number; recordsWritten: number; error: string | null }[];
};
type Dependency = { id: string; label: string; status: "healthy" | "attention" | "down" | "idle"; detail: string; ageSeconds: number | null; latencyMs: number | null; derivedFrom: string };
type Worker = {
  status: "healthy" | "stale" | "never"; ageSeconds: number | null; lastRunAt: string | null; lastFinishedAt: string | null;
  recordsWritten: number; recordsSeen: number; source: string | null; runType: string | null; error: string | null;
  recentRuns: { workspaceId: string; source: string; runType: string; status: string; startedAt: string; recordsWritten: number; error: string | null }[];
};
type Granola = {
  state: "idle" | "starting" | "ok" | "down"; inWindow: boolean; ageSeconds: number | null; lastCheckedAt: string | null;
  callsFound: number; clientsChecked: number;
  clients: { slug: string; name: string; title: string | null; ageDays: number | null; isNew: boolean }[];
  recentChecks: { checkedAt: string | null; callsFound: number; clientsChecked: number }[];
};
type Health = { dependencies: Dependency[]; worker: Worker; granola: Granola };

/** Worst first: a client with no key needs plumbing, one on "attention" has stopped, one healthy needs nothing. */
const RANK: Record<Ops["health"], number> = { missing: 0, attention: 1, healthy: 2 };

/** "4h ago", "2d ago" — heartbeats are read as an age, never as a timestamp. */
function ago(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "never";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function Ops() {
  const [clients, setClients] = useState<Ops[]>([]);
  const [runs, setRuns] = useState<Runs | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/admin/ops", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError(payload.error || "That did not load.");
          return;
        }
        setClients(payload.clients ?? []);
        setRuns(payload.runs ?? null);
        setHealth(payload.health ?? null);
        setCheckedAt(payload.checkedAt ?? null);
      } catch {
        setError("That did not load.");
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const nameById = new Map(clients.map((c) => [c.id, c.name]));
  const clientName = (id: string) => nameById.get(id) || id.slice(0, 8);
  const sorted = [...clients].sort((a, b) => RANK[a.health] - RANK[b.health] || a.name.localeCompare(b.name));
  const counts = {
    healthy: clients.filter((c) => c.health === "healthy").length,
    attention: clients.filter((c) => c.health === "attention").length,
    missing: clients.filter((c) => c.health === "missing").length,
  };
  const peak = Math.max(1, ...(runs?.series ?? []).map((p) => p.ok + p.error));

  return (
    <div className="content">
      <div className="page-head">
        <h1>Admin</h1>
      </div>

      <div className="ops-tabs">
        <Link href="/admin" className="ops-tab">Logins</Link>
        <span className="ops-tab active">System health</span>
      </div>

      {checkedAt && <p className="ops-checked">Checked {ago(checkedAt)} · reads the same database Reply Radar writes to</p>}

      {error && <p className="error-note">{error}</p>}

      {/* The tether, first — the whole reason to open this page is to see the pipe is moving. */}
      {health && (
        <>
          <div className="ops-deps">
            {health.dependencies.map((dep) => (
              <div key={dep.id} className={`ops-dep is-${dep.status}`}>
                <span className="ops-dep-top">
                  <i className="ops-dep-dot" />
                  <b>{dep.label}</b>
                  <span className="ops-dep-status">{dep.status}</span>
                </span>
                <span className="ops-dep-detail">{dep.detail}</span>
                <span className="ops-dep-from">{dep.derivedFrom}</span>
              </div>
            ))}
          </div>

          <div className="ops-hb-grid">
            <WorkerCard worker={health.worker} clientName={clientName} />
            <GranolaCard granola={health.granola} />
          </div>
        </>
      )}

      <div className="metrics">
        <div className="metric">
          <span className="metric-label">Running clean</span>
          <span className="metric-value green">{counts.healthy}</span>
          <span className="metric-note">webhook and poll both fresh</span>
        </div>
        <div className="metric">
          <span className="metric-label">Needs attention</span>
          <span className="metric-value" style={{ color: counts.attention ? "var(--amber)" : undefined }}>{counts.attention}</span>
          <span className="metric-note">poll over 1h or webhook over 7d</span>
        </div>
        <div className="metric">
          <span className="metric-label">Not connected</span>
          <span className="metric-value" style={{ color: counts.missing ? "var(--coral)" : undefined }}>{counts.missing}</span>
          <span className="metric-note">no HeyReach key set</span>
        </div>
        <div className="metric">
          <span className="metric-label">Records written, 48h</span>
          <span className="metric-value">{(runs?.series ?? []).reduce((s, p) => s + p.written, 0).toLocaleString()}</span>
          <span className="metric-note">across every client</span>
        </div>
      </div>

      {runs && runs.series.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h2>Sync runs, last 48 hours</h2>
            <span>Hourly — data actually landing</span>
          </div>
          <div className="chart">
            {runs.series.map((point) => (
              <div key={point.hour} className="chart-col" title={`${point.hour} · ${point.ok} ok, ${point.error} failed, ${point.written} written`}>
                {point.error > 0 && <div className="chart-bar" style={{ background: "var(--coral)", height: `${(point.error / peak) * 100}%` }} />}
                <div className="chart-bar accepted" style={{ height: `${(point.ok / peak) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="chart-legend">
            <span><b style={{ background: "var(--green)" }} />Successful runs</span>
            <span><b style={{ background: "var(--coral)" }} />Failed runs</span>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <h2>Every client</h2>
          <span>Worst first · click a row for its configuration</span>
        </div>
        {!loaded ? (
          <p className="loading">Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="empty">No clients.</p>
        ) : (
          <div className="table-wrap">
            <table className="rows">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Health</th>
                  <th className="num">Webhook</th>
                  <th className="num">Poll</th>
                  <th className="num">Reconciled</th>
                  <th className="num">Events 24h</th>
                  <th className="num">Failures 24h</th>
                  <th className="num">Volume</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((client) => (
                  <Fragment key={client.id}>
                    <tr onClick={() => setOpen(open === client.id ? null : client.id)} style={{ cursor: "pointer" }}>
                      <td>
                        <span className="primary">{client.name}</span>
                        <span className="sub">{client.slug}</span>
                      </td>
                      <td><span className={`pill health-${client.health}`}>{client.health}</span></td>
                      <td className="num" style={{ color: client.webhookHealthy ? undefined : "var(--amber)" }}>{ago(client.lastWebhookAt)}</td>
                      <td className="num" style={{ color: client.pollHealthy ? undefined : "var(--amber)" }}>{ago(client.lastPollAt)}</td>
                      <td className="num">{ago(client.lastReconciledAt)}</td>
                      <td className="num">{client.webhookEvents24h.toLocaleString()}</td>
                      <td className="num" style={{ color: client.failedRuns24h + client.webhookFailures24h > 0 ? "var(--coral)" : undefined }}>
                        {client.failedRuns24h + client.webhookFailures24h}
                      </td>
                      <td className="num">{client.campaigns} camp · {client.conversations.toLocaleString()} conv</td>
                    </tr>
                    {open === client.id && (
                      <tr>
                        <td colSpan={8} style={{ background: "var(--panel-2)" }}>
                          <div className="ops-config">
                            <Row label="HeyReach key" value={client.heyreachConnected ? "connected" : "missing"} bad={!client.heyreachConnected} />
                            <Row label="CRM" value={client.crmProvider ? `${client.crmProvider} · synced ${ago(client.crmLastSyncedAt)}` : "not connected"} />
                            <Row label="Timezone" value={client.timezone} />
                            <Row label="Website" value={client.websiteUrl ?? "—"} />
                            <Row label="Brain folder" value={client.brainFolder ?? "—"} />
                            <Row label="Airtable base" value={client.airtableBaseId ?? "—"} />
                            <Row label="Slack internal" value={client.slackInternalChannelId ?? "—"} />
                            <Row label="Slack external" value={client.slackExternalChannelId ?? "—"} />
                            <Row label="Morning brief" value={client.morningBriefEnabled ? "on" : "off"} />
                            <Row label="Call analysis" value={client.callAnalysisEnabled ? "on" : "off"} />
                            <Row label="EOW report" value={client.eowReportEnabled ? "on" : "off"} />
                            <Row label="Onboarding" value={client.onboardingStatus ?? "—"} />
                            <Row
                              label="Last sync run"
                              value={client.lastRun ? `${client.lastRun.source}/${client.lastRun.runType} — ${client.lastRun.status} ${ago(client.lastRun.finishedAt)}` : "none"}
                              bad={client.lastRun?.status === "error"}
                            />
                            {client.lastRun?.error && <Row label="Last error" value={client.lastRun.error} bad />}
                          </div>
                          <div style={{ padding: "0 20px 18px" }}>
                            <Link className="button ghost small" href={`/?client=${encodeURIComponent(client.slug)}`}>
                              Open this client&apos;s portal →
                            </Link>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {runs && runs.latest.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h2>Latest sync runs</h2>
            <span>Newest 60</span>
          </div>
          <div className="table-wrap">
            <table className="rows">
              <thead>
                <tr>
                  <th>Client</th><th>Source</th><th>Type</th><th>Status</th>
                  <th className="num">Seen</th><th className="num">Written</th><th className="num">Started</th>
                </tr>
              </thead>
              <tbody>
                {runs.latest.map((run, index) => {
                  const client = clients.find((c) => c.id === run.workspaceId);
                  return (
                    <tr key={`${run.startedAt}-${index}`}>
                      <td>{client?.name ?? "—"}</td>
                      <td>{run.source}</td>
                      <td>{run.runType}</td>
                      <td>
                        <span className={`pill ${run.status === "error" ? "off" : "active"}`}>{run.status}</span>
                        {run.error && <span className="sub">{run.error.slice(0, 120)}</span>}
                      </td>
                      <td className="num">{run.recordsSeen.toLocaleString()}</td>
                      <td className="num">{run.recordsWritten.toLocaleString()}</td>
                      <td className="num">{ago(run.startedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function fmtAge(seconds: number | null): string {
  if (seconds === null) return "never";
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/**
 * The worker heartbeat.
 *
 * This is the single most important thing on the page. The worker is what pulls from HeyReach and
 * writes to the database this portal reads — if it stops, everything here silently freezes at its last
 * value and nothing else would tell you. So its last tick, what it wrote, and its recent runs are shown
 * in full.
 */
function WorkerCard({ worker, clientName }: { worker: Worker; clientName: (id: string) => string }) {
  return (
    <div className="panel ops-hb">
      <div className="panel-head">
        <h2>Worker heartbeat</h2>
        <span className={`pill ${worker.status === "healthy" ? "active" : "off"}`}>{worker.status}</span>
      </div>
      <div className="ops-hb-body">
        <div className="ops-hb-stats">
          <div><span>Last tick</span><b>{fmtAge(worker.ageSeconds)}{worker.ageSeconds === null ? "" : " ago"}</b></div>
          <div><span>Wrote</span><b>{worker.recordsWritten.toLocaleString()}</b></div>
          <div><span>Saw</span><b>{worker.recordsSeen.toLocaleString()}</b></div>
        </div>
        {worker.error && <p className="ops-hb-err">{worker.error.slice(0, 160)}</p>}
        <div className="ops-hb-runs">
          {worker.recentRuns.slice(0, 10).map((run, index) => (
            <div key={index} className="ops-hb-run">
              <i className={run.status === "error" ? "bad" : "ok"} />
              <span className="ops-hb-run-src">{run.runType || run.source || "run"}</span>
              <span className="ops-hb-run-c">{clientName(run.workspaceId)}</span>
              <span className="ops-hb-run-w">+{run.recordsWritten.toLocaleString()}</span>
              <time>{ago(run.startedAt)}</time>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The Granola heartbeat.
 *
 * Reply Radar polls Granola for new call recordings between 5am and 8pm Eastern; outside that window it
 * is idle by design, so a gap overnight is the system resting, not failing. The verdict here follows the
 * same window logic as Reply Radar's own health page, so the two never disagree.
 */
function GranolaCard({ granola }: { granola: Granola }) {
  const label = granola.state === "ok" ? "healthy" : granola.state === "idle" ? "idle" : granola.state === "starting" ? "starting" : "down";
  return (
    <div className="panel ops-hb">
      <div className="panel-head">
        <h2>Granola call poll</h2>
        <span className={`pill ${granola.state === "ok" ? "active" : granola.state === "down" ? "off" : ""}`}>{label}</span>
      </div>
      <div className="ops-hb-body">
        <div className="ops-hb-stats">
          <div><span>Last poll</span><b>{fmtAge(granola.ageSeconds)}{granola.ageSeconds === null ? "" : " ago"}</b></div>
          <div><span>Calls found</span><b>{granola.callsFound}</b></div>
          <div><span>Clients</span><b>{granola.clientsChecked}</b></div>
        </div>
        <p className="ops-hb-note">
          {granola.inWindow ? "Inside the 5am–8pm ET poll window." : "Outside the poll window — idle by design until 5am ET."}
        </p>
        {granola.clients.length > 0 && (
          <div className="ops-hb-runs">
            {granola.clients.slice(0, 8).map((c) => (
              <div key={c.slug} className="ops-hb-run">
                <i className={c.isNew ? "ok" : "idle"} />
                <span className="ops-hb-run-c">{c.name}</span>
                <span className="ops-hb-run-src">{c.title ? c.title.slice(0, 40) : "no call"}</span>
                <time>{c.ageDays == null ? "—" : `${c.ageDays}d`}</time>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="ops-config-row">
      <span>{label}</span>
      <strong style={bad ? { color: "var(--coral)" } : undefined}>{value}</strong>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Ops />
    </Suspense>
  );
}
