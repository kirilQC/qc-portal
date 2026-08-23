// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";
/* eslint-disable react-hooks/set-state-in-effect -- loads on mount and when the client changes; the
   setState calls sit inside async callbacks rather than the effect body. */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import "./analytics.css";

/**
 * One client's analytics, reproduced from Reply Radar's own page.
 *
 * The layout, the labels, the eleven figures and the order they appear in are all deliberately the
 * same, because the point is that a client reading this and QC reading Reply Radar are looking at one
 * set of numbers rather than two. Every rate is computed server-side using Reply Radar's conventions —
 * see the note in `app/api/analytics/route.ts` for why each divides by what it does.
 *
 * One difference: "Sync now" is staff-only. Everything else here reads; that button writes a job for
 * the worker, and it is not something a client should be able to press repeatedly.
 */
type Campaign = {
  campaignId: string; name: string; status: string | null; launchedAt: string | null;
  senderIds: string[]; totalLeads: number; leadsPending: number;
  connectionsSent: number; connectionsAccepted: number; replies: number; positiveReplies: number;
  messagesStarted: number; sequenceSteps: number | null;
  firstTouch: string | null; followUp: string | null;
  acceptanceRate: number; replyRate: number; positiveReplyRate: number; daysLeft: number | null;
};
type DailyPoint = { day: string; label: string; connectionsSent: number; connectionsAccepted: number; replies: number };
type SenderSeries = { id: string; name: string; dailyLimit: number | null; connectionsSent: number; connectionsAccepted: number; byDay: number[] };
type Payload = {
  ok: boolean; status: string; role?: "staff" | "client"; error?: string;
  workspace?: { id: string; name: string; slug: string; logoUrl: string | null; accentColor: string | null };
  campaigns?: Campaign[]; daily?: DailyPoint[]; senders?: SenderSeries[]; senderCap?: number;
  repliesSynced?: number; replies7d?: number; conversations?: number; collectedAt?: string | null;
  sync?: { state: string; lastStatus: string | null; lastFinishedAt: string | null; lastError: string | null };
};

const sum = <T,>(rows: T[], of: (row: T) => number) => rows.reduce((total, row) => total + of(row), 0);

/** Campaigns with enough volume for a rate to mean anything. Reply Radar's threshold. */
const RANKABLE_MINIMUM = 50;
const rankable = (rows: Campaign[]) => rows.filter((row) => row.connectionsSent >= RANKABLE_MINIMUM);

const launchDate = (value: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

/** How long we have worked with a client, measured from their first real campaign launch. */
function engagementRuntime(rows: Campaign[], now: number) {
  const stamps = rows.map((row) => (row.launchedAt ? Date.parse(row.launchedAt) : NaN)).filter((stamp) => Number.isFinite(stamp));
  // `now` is 0 for the first frame, before the clock has been read. Waiting is better than reading it
  // during render, which would make the label depend on when React happened to re-render.
  if (!stamps.length || !now) return { label: "—", since: "Launch dates unavailable" };
  const first = Math.min(...stamps);
  const days = Math.max(0, Math.floor((now - first) / 86_400_000));
  const months = Math.floor(days / 30.44);
  const label =
    days < 31 ? `${days} day${days === 1 ? "" : "s"}` :
    months < 12 ? `${months} month${months === 1 ? "" : "s"}` :
    `${Math.floor(months / 12)}y ${months % 12}m`;
  return { label, since: `Since ${launchDate(new Date(first).toISOString())}` };
}

/** Time alone for figures taken today; the date too once they are older, so a day-old stamp reads as one. */
const syncedLabel = (at: Date) =>
  at.toDateString() === new Date().toDateString()
    ? at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : at.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const LEADER_METRICS = [
  { id: "accepted", label: "Connections accepted", of: (row: Campaign) => row.connectionsAccepted },
  { id: "replies", label: "Total replies", of: (row: Campaign) => row.replies },
  { id: "positive", label: "Positive replies", of: (row: Campaign) => row.positiveReplies },
] as const;

function Analytics() {
  const params = useSearchParams();
  const clientSlug = params.get("client");

  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [leaderMetric, setLeaderMetric] = useState<string>("accepted");
  const [open, setOpen] = useState<Campaign | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [now, setNow] = useState(0);

  useEffect(() => setNow(Date.now()), []);

  const load = useCallback(async () => {
    try {
      const query = clientSlug ? `?client=${encodeURIComponent(clientSlug)}` : "";
      const response = await fetch(`/api/analytics${query}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as Payload;
      if (!response.ok) {
        setError(payload.error || "Analytics did not load.");
        return;
      }
      setError("");
      setData(payload);
    } catch {
      setError("Analytics did not load.");
    }
  }, [clientSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  // Escape closes the campaign modal, which is what a dialog is expected to do.
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open]);

  async function sync() {
    if (!clientSlug || syncing) return;
    setSyncing(true);
    try {
      await fetch(`/api/analytics/refresh?client=${encodeURIComponent(clientSlug)}`, { method: "POST" });
      await load();
    } finally {
      setSyncing(false);
    }
  }

  const view = useMemo(() => {
    const campaigns = data?.campaigns ?? [];
    const daily = data?.daily ?? [];
    const senders = data?.senders ?? [];
    const senderCap = data?.senderCap ?? 25;

    const average = (key: "replyRate" | "acceptanceRate" | "positiveReplyRate") =>
      campaigns.length ? sum(campaigns, (row) => row[key]) / campaigns.length : null;

    const ranked = rankable(campaigns);
    const metric = LEADER_METRICS.find((option) => option.id === leaderMetric) ?? LEADER_METRICS[0];

    return {
      campaigns, daily, senders, senderCap, average,
      // HeyReach's reply totals cover the whole campaign history, not just what we have synced.
      allTimeReplies: sum(campaigns, (row) => row.replies),
      contacted: sum(campaigns, (row) => row.connectionsSent),
      accepted: sum(campaigns, (row) => row.connectionsAccepted),
      launched: campaigns.filter((row) => row.launchedAt).length,
      // Campaigns still working through their list, longest runway first — the ones that need senders.
      running: campaigns
        .filter((row) => (row.status ?? "").toUpperCase() === "IN_PROGRESS")
        .sort((a, b) => (b.daysLeft ?? 0) - (a.daysLeft ?? 0) || b.leadsPending - a.leadsPending),
      windowSent: sum(daily, (point) => point.connectionsSent),
      sentMax: Math.max(...daily.map((point) => point.connectionsSent), 1),
      // The stacked chart is scaled on its own busiest column rather than the total series, so the two
      // charts are read independently and neither flattens the other.
      stackMax: Math.max(...daily.map((_, index) => sum(senders, (sender) => sender.byDay[index] ?? 0)), 1),
      metric,
      leaders: [...ranked].sort((a, b) => metric.of(b) - metric.of(a)).slice(0, 6),
      // Worst acceptance first. Acceptance rather than replies because it is the earliest thing that
      // can be wrong: nothing downstream of a request nobody accepted is worth diagnosing.
      laggards: [...ranked].sort((a, b) => a.acceptanceRate - b.acceptanceRate).slice(0, 6),
      leaderMax: Math.max(...ranked.map((row) => metric.of(row)), 1),
    };
  }, [data, leaderMetric]);

  if (!clientSlug && (error || data?.status === "no_client")) {
    return <div className="content"><p className="empty">Pick a client from the directory first.</p></div>;
  }
  if (error) return <div className="content"><p className="error-note">{error}</p></div>;
  if (!data?.workspace) return <div className="content"><p className="loading">Loading…</p></div>;

  const client = data.workspace;
  const runtime = engagementRuntime(view.campaigns, now);
  const collectedAt = data.collectedAt ? new Date(data.collectedAt) : null;
  const inFlight = syncing || (data.sync?.state ?? "idle") !== "idle";
  const rate = (value: number | null) => (value == null ? "—" : `${value.toFixed(1)}%`);

  return (
    <div className="analytics-dashboard">
      <header className="analytics-hero client-hero">
        <div className="client-hero-identity">
          <i className="client-hero-logo" style={client.logoUrl ? undefined : { background: client.accentColor || "var(--accent)" }}>
            {client.logoUrl ? <img src={client.logoUrl} alt={client.name} /> : client.name[0]}
          </i>
          <div>
            <h1>{client.name}</h1>
          </div>
        </div>
        <div className="client-hero-sync">
          {/*
            * Stamped with when the worker last read HeyReach, not with when this page was opened. The
            * figures are up to a day old, and saying so is the difference between a stale number and a
            * wrong one — which is also what the button beside it is for.
            */}
          <div className="analytics-live"><i /> {collectedAt ? `Last synced @ ${syncedLabel(collectedAt)}` : "Not synced yet"}</div>
          {data.role === "staff" && (
            <button className="client-resync" onClick={() => void sync()} disabled={inFlight}>
              {inFlight ? "Syncing…" : "Sync now"}
            </button>
          )}
        </div>
      </header>

      <section className="analytics-kpis">
        <Kpi label="All-time replies" value={view.allTimeReplies.toLocaleString()} sub={`${(data.repliesSynced ?? 0).toLocaleString()} synced to the inbox`} />
        <Kpi label="Average reply rate" value={rate(view.average("replyRate"))} />
        <Kpi label="Average acceptance rate" value={rate(view.average("acceptanceRate"))} />
        <Kpi label="Average positive reply rate" value={rate(view.average("positiveReplyRate"))} />
        <Kpi label="Engagement runtime" value={runtime.label} sub={runtime.since} />
      </section>

      <section className="analytics-kpis analytics-kpis-secondary">
        <Kpi label="Leads reached out to" value={view.contacted.toLocaleString()} sub="Connection requests sent, all time" />
        <Kpi label="Connections accepted" value={view.accepted.toLocaleString()} sub={view.contacted ? `${((view.accepted / view.contacted) * 100).toFixed(1)}% of requests sent` : undefined} />
        <Kpi label="Campaigns launched" value={view.launched.toLocaleString()} sub={`${view.campaigns.length.toLocaleString()} tracked`} />
        <Kpi label="Campaigns running" value={view.running.length.toLocaleString()} sub={`${view.senders.length} sender${view.senders.length === 1 ? "" : "s"} active`} />
        <Kpi label="Requests last 14 days" value={view.windowSent.toLocaleString()} sub={`${Math.round(view.windowSent / Math.max(view.daily.length, 1)).toLocaleString()} a day`} />
      </section>

      <section className="analytics-primary">
        <article className="analytics-card analytics-trend">
          <CardTitle title="Connection requests sent" subtitle={`Every sender, day by day · ${view.windowSent.toLocaleString()} in the last ${view.daily.length || 14} days`} />
          <div className="analytics-bars">
            {view.daily.map((point) => (
              <div key={point.day}>
                <strong>{point.connectionsSent}</strong>
                <i style={{ height: `${Math.max(4, (point.connectionsSent / view.sentMax) * 100)}%` }} />
                <small>{point.label}</small>
              </div>
            ))}
          </div>
          {!view.daily.length && <p className="empty-state">No daily figures collected yet.</p>}
        </article>
      </section>

      <section className="analytics-primary">
        <article className="analytics-card">
          <CardTitle
            title="Connection requests by sender"
            subtitle={`${view.senders.length} sender${view.senders.length === 1 ? "" : "s"} · ${view.senderCap} a day each is the cap, so a full column is about ${(view.senders.length * view.senderCap).toLocaleString()}`}
          />
          {/* Stacked as divs: each sender is one segment of the day's column, sized against the busiest
              day in the window, so a column's height is the day's total and its bands are who sent it. */}
          <div className="sender-stack">
            {view.daily.map((point, index) => {
              const total = sum(view.senders, (sender) => sender.byDay[index] ?? 0);
              return (
                <div key={point.day}>
                  <strong>{total || ""}</strong>
                  <span>
                    {view.senders.map((sender, order) => {
                      const value = sender.byDay[index] ?? 0;
                      if (!value) return null;
                      return <i key={sender.id} data-tone={order % 6} style={{ height: `${(value / view.stackMax) * 100}%` }} title={`${sender.name}: ${value}`} />;
                    })}
                  </span>
                  <small>{point.label}</small>
                </div>
              );
            })}
          </div>
          <div className="sender-legend">
            {view.senders.map((sender, order) => (
              <span key={sender.id}>
                <i data-tone={order % 6} />
                <em>{sender.name}</em>
                <b>{sender.connectionsSent.toLocaleString()}</b>
                <small>
                  {Math.round(sender.connectionsSent / Math.max(view.daily.length, 1))}/day{sender.dailyLimit ? ` of ${sender.dailyLimit}` : ""}
                </small>
              </span>
            ))}
          </div>
          {!view.senders.length && <p className="empty-state">No sender activity in the last fortnight.</p>}
        </article>
      </section>

      <section className="analytics-grid">
        <article className="analytics-card analytics-ranking">
          <CardTitle title="Active campaigns" subtitle={`Sending days left at ${view.senderCap} requests per sender per day`} />
          {view.running.length ? view.running.slice(0, 8).map((campaign) => (
            <button type="button" className="campaign-runway" key={campaign.campaignId} onClick={() => setOpen(campaign)}>
              <span>
                <strong>{campaign.name}</strong>
                <small>{campaign.senderIds.length} sender{campaign.senderIds.length === 1 ? "" : "s"} · {campaign.leadsPending.toLocaleString()} still to contact</small>
              </span>
              <data>{campaign.daysLeft === null ? "—" : campaign.daysLeft === 0 ? "Done" : `${campaign.daysLeft}d`}</data>
            </button>
          )) : <p className="empty-state">Nothing running right now.</p>}
        </article>

        <article className="analytics-card analytics-ranking">
          <CardTitle title="Best performing campaigns" subtitle={`Over ${RANKABLE_MINIMUM} requests sent`} />
          {/* Three buttons rather than a select, because the point is switching between them to compare. */}
          <div className="metric-toggle">
            {LEADER_METRICS.map((option) => (
              <button type="button" key={option.id} className={option.id === view.metric.id ? "is-active" : ""} onClick={() => setLeaderMetric(option.id)}>
                {option.label}
              </button>
            ))}
          </div>
          {view.leaders.length ? view.leaders.map((campaign, index) => (
            <button type="button" className="analytics-rank is-button" key={campaign.campaignId} onClick={() => setOpen(campaign)}>
              <b>{index + 1}</b>
              <span>
                <strong>{campaign.name}</strong>
                <small>{campaign.acceptanceRate.toFixed(1)}% accepted · {campaign.replyRate.toFixed(1)}% replied</small>
                <i><em style={{ width: `${(view.metric.of(campaign) / view.leaderMax) * 100}%` }} /></i>
              </span>
              <data>{view.metric.of(campaign).toLocaleString()}</data>
            </button>
          )) : <p className="empty-state">No campaign has sent enough to rank yet.</p>}
        </article>

        <article className="analytics-card analytics-ranking">
          <CardTitle title="Underperforming campaigns" subtitle="Lowest acceptance rate first" />
          {view.laggards.length ? view.laggards.map((campaign) => (
            <button type="button" className="analytics-rank is-button no-index" key={campaign.campaignId} onClick={() => setOpen(campaign)}>
              <span>
                <strong>{campaign.name}</strong>
                <small>{campaign.connectionsSent.toLocaleString()} sent · {campaign.connectionsAccepted.toLocaleString()} accepted · {campaign.replies.toLocaleString()} replies</small>
                <i><em className="is-warning" style={{ width: `${Math.min(100, campaign.acceptanceRate * 2)}%` }} /></i>
              </span>
              <data>{campaign.acceptanceRate.toFixed(1)}%</data>
            </button>
          )) : <p className="empty-state">No campaign has sent enough to rank yet.</p>}
        </article>
      </section>

      {open && (
        <div className="campaign-modal-backdrop">
          <button type="button" className="campaign-modal-dismiss" aria-label="Close campaign details" onClick={() => setOpen(null)} />
          <div className="campaign-modal" role="dialog" aria-modal="true" aria-label={open.name}>
            <header>
              <div>
                <span>{launchDate(open.launchedAt)}{open.status ? ` · ${open.status.replace(/_/g, " ").toLowerCase()}` : ""}</span>
                <h3>{open.name}</h3>
              </div>
              <button aria-label="Close" onClick={() => setOpen(null)}>×</button>
            </header>
            <div className="campaign-modal-grid">
              <Kpi label="Reply rate" value={`${open.replyRate.toFixed(1)}%`} />
              <Kpi label="Acceptance rate" value={`${open.acceptanceRate.toFixed(1)}%`} />
              <Kpi label="Positive reply rate" value={`${open.positiveReplyRate.toFixed(1)}%`} />
              <Kpi label="Connections sent" value={open.connectionsSent.toLocaleString()} />
              <Kpi label="Connections accepted" value={open.connectionsAccepted.toLocaleString()} />
              <Kpi label="Replies" value={open.replies.toLocaleString()} />
              <Kpi label="Positive replies" value={open.positiveReplies.toLocaleString()} />
              <Kpi label="Messages started" value={open.messagesStarted.toLocaleString()} />
              <Kpi label="Leads in list" value={open.totalLeads.toLocaleString()} />
              <Kpi label="Still to contact" value={open.leadsPending.toLocaleString()} sub={open.daysLeft ? `about ${open.daysLeft} sending day${open.daysLeft === 1 ? "" : "s"} left` : undefined} />
              <Kpi label="Senders assigned" value={open.senderIds.length.toLocaleString()} />
              <Kpi label="Sequence steps" value={open.sequenceSteps == null ? "—" : open.sequenceSteps.toLocaleString()} />
            </div>
            {(open.firstTouch || open.followUp) && (
              <div className="campaign-modal-copy">
                {open.firstTouch && <div><span>Connection request</span><p>{open.firstTouch}</p></div>}
                {open.followUp && <div><span>First message after acceptance</span><p>{open.followUp}</p></div>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string | number | undefined; sub?: string }) {
  return <div className="analytics-kpi"><span>{label}</span><strong>{value ?? "—"}</strong>{sub ? <small>{sub}</small> : null}</div>;
}

function CardTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return <header className="analytics-card-title"><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</header>;
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Analytics />
    </Suspense>
  );
}
