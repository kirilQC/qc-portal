// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { Suspense, useEffect, useState } from "react";
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
  streams: { replies: Stream; stats: Stream; reconcile: Stream };
  verdictLevel: "ok" | "watch" | "stalled" | "missing";
  verdictWord: string;
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
type Stream = { level: "ok" | "watch" | "stalled" | "idle"; ageSeconds: number | null; note: string };
type Verdict = { level: "good" | "bad"; headline: string; detail: string; flagged: { name: string; slug: string; word: string; level: string }[] };

/** Worst first: a stalled client was working and stopped, missing was never plumbed, watch is soft, ok is fine. */
const RANK: Record<Ops["verdictLevel"], number> = { stalled: 0, missing: 1, watch: 2, ok: 3 };

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
  const [health, setHealth] = useState<Health | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
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
        setHealth(payload.health ?? null);
        setVerdict(payload.verdict ?? null);
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
  const sorted = [...clients].sort((a, b) => RANK[a.verdictLevel] - RANK[b.verdictLevel] || a.name.localeCompare(b.name));

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

      {/* The one honest headline. Green means close the tab; red says exactly what and for how long. */}
      {verdict && (
        <div className={`ops-verdict is-${verdict.level}`}>
          <div className={`ops-verdict-mark ${verdict.level === "good" ? "pulse" : ""}`}>{verdict.level === "good" ? "✓" : "!"}</div>
          <div className="ops-verdict-t">
            <b>{verdict.headline}</b>
            <span>{verdict.detail}</span>
          </div>
        </div>
      )}

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

      <div className="panel ops-fresh-panel">
        <div className="panel-head">
          <h2>Every client</h2>
          <span>Worst first · click a client for its configuration</span>
        </div>
        {!loaded ? (
          <p className="loading">Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="empty">No clients.</p>
        ) : (
          <div className="ops-fresh">
            {sorted.map((client) => (
              <ClientHealth
                key={client.id}
                client={client}
                open={open === client.id}
                onToggle={() => setOpen(open === client.id ? null : client.id)}
              />
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

/**
 * One client, as a freshness verdict rather than a row of raw timestamps.
 *
 * The two HeyReach streams — Replies and Campaign stats — plus the reconcile gap-check each show a
 * colour, an age and a plain word, so a glance tells you whether a number is healthy without knowing
 * that a poll should be under an hour. The raw configuration is one click down, in the drawer.
 */
function ClientHealth({ client, open, onToggle }: { client: Ops; open: boolean; onToggle: () => void }) {
  const failures = client.failedRuns24h + client.webhookFailures24h;
  return (
    <div className={`ops-cl v-${client.verdictLevel}`}>
      <button className="ops-cl-main" onClick={onToggle} aria-expanded={open}>
        <span className="ops-cl-name">
          <b>{client.name}</b>
          <small>{client.slug}</small>
        </span>
        <Sig label="Replies · webhook" s={client.streams.replies} />
        <Sig label="Campaign stats · poll" s={client.streams.stats} />
        <Sig label="Gap check · reconcile" s={client.streams.reconcile} />
        <span className="ops-cl-verdict">{client.verdictWord}</span>
        <span className="ops-cl-chev">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="ops-cl-drawer">
          <div className="ops-config">
            <Row label="HeyReach key" value={client.heyreachConnected ? "connected" : "missing"} bad={!client.heyreachConnected} />
            <Row label="Replies last received" value={ago(client.lastWebhookAt)} />
            <Row label="Stats last polled" value={ago(client.lastPollAt)} bad={!client.pollHealthy} />
            <Row label="Gaps last checked" value={ago(client.lastReconciledAt)} />
            <Row label="Failures, 24h" value={String(failures)} bad={failures > 0} />
            <Row label="Volume" value={`${client.campaigns} campaigns · ${client.conversations.toLocaleString()} conversations`} />
            <Row label="CRM" value={client.crmProvider ? `${client.crmProvider} · synced ${ago(client.crmLastSyncedAt)}` : "not connected"} />
            <Row label="Timezone" value={client.timezone} />
            <Row label="Brain folder" value={client.brainFolder ?? "—"} />
            <Row label="Morning brief" value={client.morningBriefEnabled ? "on" : "off"} />
            <Row label="Call analysis" value={client.callAnalysisEnabled ? "on" : "off"} />
            <Row label="Onboarding" value={client.onboardingStatus ?? "—"} />
            <Row
              label="Last sync run"
              value={client.lastRun ? `${client.lastRun.source}/${client.lastRun.runType} — ${client.lastRun.status} ${ago(client.lastRun.finishedAt)}` : "none"}
              bad={client.lastRun?.status === "error"}
            />
            {client.lastRun?.error && <Row label="Last error" value={client.lastRun.error} bad />}
          </div>
          <div style={{ padding: "0 4px 4px" }}>
            <Link className="button ghost small" href={`/?client=${encodeURIComponent(client.slug)}`}>
              Open this client&apos;s portal →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/** One stream's freshness pill: a dot in its verdict colour, the age, and what the age means. */
function Sig({ label, s }: { label: string; s: Stream }) {
  return (
    <span className="ops-sig">
      <span className="ops-sig-k">{label}</span>
      <span className="ops-sig-v">
        <i className={`ops-sig-dot ${s.level}`} />
        <b>{s.level === "idle" && s.ageSeconds === null ? "—" : fmtAge(s.ageSeconds)}{s.ageSeconds === null || s.level === "idle" ? "" : " ago"}</b>
      </span>
      <span className="ops-sig-note">{s.note}</span>
    </span>
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
