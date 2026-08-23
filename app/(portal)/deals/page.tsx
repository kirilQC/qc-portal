// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { Suspense } from "react";
import ClientHead from "../../components/ClientHead";
import { money, shortDate, usePortal } from "../../components/usePortal";

/**
 * Pipeline, with the strength of the claim shown next to every line.
 *
 * "Confirmed" means a specific person QC contacted or met is on the deal. "Possible" means only the
 * company matched — the right company, but no evidence tying it to anyone we spoke to. Showing both,
 * labelled, is the honest presentation: a client who later finds a "possible" was actually inbound has
 * lost no trust, because nobody claimed otherwise.
 */
function Deals() {
  const { data, error, loading } = usePortal();

  if (loading) return <div className="content"><p className="loading">Loading…</p></div>;
  if (error) return <div className="content"><p className="error-note">{error}</p></div>;
  if (data?.view === "directory") return <div className="content"><p className="empty">Pick a client first.</p></div>;

  const client = data?.client;
  const deals = data?.deals ?? [];
  const o = data?.overview;
  if (!client) return <div className="content"><p className="empty">Nothing to show yet.</p></div>;

  return (
    <div className="content">
      <ClientHead client={client} sub="Pipeline attributed to outbound" />

      <div className="metrics">
        <div className="metric">
          <span className="metric-label">Confirmed pipeline</span>
          <span className="metric-value green">{money(o?.confirmedPipeline ?? 0)}</span>
          <span className="metric-note">Traced to a person we contacted</span>
        </div>
        <div className="metric">
          <span className="metric-label">Possible pipeline</span>
          <span className="metric-value">{money(o?.possiblePipeline ?? 0)}</span>
          <span className="metric-note">Company matched, person did not</span>
        </div>
        <div className="metric">
          <span className="metric-label">Deals</span>
          <span className="metric-value">{deals.length}</span>
          <span className="metric-note">{deals.filter((d) => d.attribution === "confirmed").length} confirmed</span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Deals</h2>
          <span>Confirmed first</span>
        </div>
        {deals.length === 0 ? (
          <p className="empty">No deals synced yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="rows">
              <thead>
                <tr>
                  <th>Deal</th>
                  <th>Company</th>
                  <th>Attribution</th>
                  <th>Stage</th>
                  <th className="num">Value</th>
                  <th className="num">Close</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <span className="primary">{row.name || "Untitled deal"}</span>
                      {row.contactName && <span className="sub">{row.contactName}</span>}
                    </td>
                    <td>{row.companyName || "—"}</td>
                    <td>
                      <span className={`pill ${row.attribution}`}>{row.attribution}</span>
                      {row.attributionReason && <span className="sub">{row.attributionReason}</span>}
                    </td>
                    <td>{row.stage || "—"}</td>
                    <td className="num">{row.amount == null ? "—" : money(row.amount, row.currency || "USD")}</td>
                    <td className="num">{shortDate(row.closeDate)}</td>
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
      <Deals />
    </Suspense>
  );
}
