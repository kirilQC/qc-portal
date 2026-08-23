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
      } catch {
        setError("That did not load.");
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

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
        <span className="eyebrow">QC team</span>
        <h1>Admin</h1>
      </div>

      <div className="ops-tabs">
        <Link href="/admin" className="ops-tab">Logins</Link>
        <span className="ops-tab active">System health</span>
      </div>

      {error && <p className="error-note">{error}</p>}

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
