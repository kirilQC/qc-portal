// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { Suspense } from "react";
import ClientHead from "../../components/ClientHead";
import { shortDate, usePortal } from "../../components/usePortal";

/** What is running, and how each one is performing. */
function Campaigns() {
  const { data, error, loading } = usePortal();

  if (loading) return <div className="content"><p className="loading">Loading…</p></div>;
  if (error) return <div className="content"><p className="error-note">{error}</p></div>;
  if (data?.view === "directory") return <div className="content"><p className="empty">Pick a client first.</p></div>;

  const client = data?.client;
  const campaigns = data?.campaigns ?? [];
  if (!client) return <div className="content"><p className="empty">Nothing to show yet.</p></div>;

  return (
    <div className="content">
      <ClientHead client={client} />
      <div className="panel">
        <div className="panel-head">
          <h2>Campaigns</h2>
          <span>{campaigns.length} total</span>
        </div>
        {campaigns.length === 0 ? (
          <p className="empty">No campaigns yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="rows">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th className="num">Reached</th>
                  <th className="num">Accepted</th>
                  <th className="num">Acceptance</th>
                  <th className="num">Replies</th>
                  <th className="num">Reply rate</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((row) => (
                  <tr key={row.campaignId}>
                    <td>
                      <span className="primary">{row.name || "Untitled campaign"}</span>
                      <span className="sub">
                        {(row.status ?? "").toLowerCase() === "active" && <span className="pill active">Running</span>}
                        {row.launchedAt ? ` Launched ${shortDate(row.launchedAt)}` : ""}
                      </span>
                    </td>
                    <td className="num">{row.connectionsSent.toLocaleString()}</td>
                    <td className="num">{row.connectionsAccepted.toLocaleString()}</td>
                    <td className="num">{row.acceptanceRate}%</td>
                    <td className="num">{row.replies.toLocaleString()}</td>
                    <td className="num">{row.replyRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Campaigns />
    </Suspense>
  );
}
