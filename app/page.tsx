// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { Suspense } from "react";
import Link from "next/link";
import Shell from "./components/Shell";
import ClientHead from "./components/ClientHead";
import { money, shortDate, usePortal } from "./components/usePortal";

/**
 * The front page, which is two different pages depending on who is looking.
 *
 * A client lands on their own results. QC's own team lands on the directory of every client and picks
 * one — and from that point on sees exactly the pages the client sees, rendered by the same components
 * against the same scoped reads. There is no separate "internal view" of a client to drift out of sync
 * with what the client is actually being shown.
 */
function Overview() {
  const { data, error, loading } = usePortal();

  if (loading) return <div className="content"><p className="loading">Loading…</p></div>;
  if (error) return <div className="content"><p className="error-note">{error}</p></div>;

  // ── Staff: the client directory ───────────────────────────────────────────────────────────────
  if (data?.view === "directory") {
    const clients = data.clients ?? [];
    return (
      <div className="content">
        <div className="page-head">
          <span className="eyebrow">QC team</span>
          <h1>Clients</h1>
        </div>
        {clients.length === 0 ? (
          <p className="empty">No clients yet.</p>
        ) : (
          <div className="directory">
            {clients.map((client) => (
              <Link key={client.id} href={`/?client=${encodeURIComponent(client.slug)}`} className="tile">
                <span
                  className="client-logo"
                  style={client.logoUrl ? undefined : { background: client.accentColor || "var(--accent)" }}
                >
                  {client.logoUrl ? <img src={client.logoUrl} alt="" /> : (client.name[0] || "?").toUpperCase()}
                </span>
                <span className="tile-name">{client.name}</span>
                <span className="tile-foot">Open portal →</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── The client's own dashboard ────────────────────────────────────────────────────────────────
  const client = data?.client;
  const o = data?.overview;
  const daily = data?.daily ?? [];
  if (!client || !o) return <div className="content"><p className="empty">Nothing to show yet.</p></div>;

  const peak = Math.max(1, ...daily.map((d) => d.connectionsSent));

  return (
    <div className="content">
      <ClientHead
        client={client}
        sub={o.startedAt ? `Outbound running since ${shortDate(o.startedAt)}` : "Your outbound programme"}
      />

      <div className="metrics">
        <div className="metric">
          <span className="metric-label">People reached</span>
          <span className="metric-value">{o.connectionsSent.toLocaleString()}</span>
          <span className="metric-note">{o.campaignsTotal} campaign{o.campaignsTotal === 1 ? "" : "s"}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Connections accepted</span>
          <span className="metric-value">{o.connectionsAccepted.toLocaleString()}</span>
          <span className="metric-note">{o.acceptanceRate}% acceptance</span>
        </div>
        <div className="metric">
          <span className="metric-label">Replies</span>
          <span className="metric-value accent">{o.replies.toLocaleString()}</span>
          <span className="metric-note">{o.replyRate}% of accepted</span>
        </div>
        <div className="metric">
          <span className="metric-label">Meetings booked</span>
          <span className="metric-value">{o.meetingsBooked.toLocaleString()}</span>
          <span className="metric-note">{o.meetingsUpcoming} upcoming</span>
        </div>
        <div className="metric">
          <span className="metric-label">Attributed pipeline</span>
          <span className="metric-value green">{money(o.confirmedPipeline)}</span>
          <span className="metric-note">
            {o.possiblePipeline > 0 ? `${money(o.possiblePipeline)} possible` : "Confirmed matches only"}
          </span>
        </div>
      </div>

      {daily.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h2>Activity, last 30 days</h2>
            <span>Requests sent and accepted</span>
          </div>
          <div className="chart">
            {daily.map((point) => (
              <div key={point.day} className="chart-col" title={`${point.day}: ${point.connectionsSent} sent, ${point.connectionsAccepted} accepted`}>
                <div className="chart-bar accepted" style={{ height: `${(point.connectionsAccepted / peak) * 100}%` }} />
                <div className="chart-bar" style={{ height: `${((point.connectionsSent - point.connectionsAccepted) / peak) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="chart-legend">
            <span><b style={{ background: "var(--accent)" }} />Requests sent</span>
            <span><b style={{ background: "var(--green)" }} />Accepted</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="loading">Loading…</div>}>
      <Shell>
        <Overview />
      </Shell>
    </Suspense>
  );
}
