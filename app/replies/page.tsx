// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { Suspense } from "react";
import Shell from "../components/Shell";
import ClientHead from "../components/ClientHead";
import { shortDate, usePortal } from "../components/usePortal";

/**
 * Who replied.
 *
 * The people and the campaign that reached them, not the transcripts. See the note in `portal-data.ts`:
 * showing a client every word of every conversation their agency is having on their behalf is a
 * different product with different consent questions attached.
 */
function Replies() {
  const { data, error, loading } = usePortal();

  if (loading) return <div className="content"><p className="loading">Loading…</p></div>;
  if (error) return <div className="content"><p className="error-note">{error}</p></div>;
  if (data?.view === "directory") return <div className="content"><p className="empty">Pick a client first.</p></div>;

  const client = data?.client;
  const replies = data?.replies ?? [];
  if (!client) return <div className="content"><p className="empty">Nothing to show yet.</p></div>;

  return (
    <div className="content">
      <ClientHead client={client} sub="Replies" />
      <div className="panel">
        <div className="panel-head">
          <h2>People who replied</h2>
          <span>{replies.length} most recent</span>
        </div>
        {replies.length === 0 ? (
          <p className="empty">No replies yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="rows">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Company</th>
                  <th>Campaign</th>
                  <th className="num">Replied</th>
                </tr>
              </thead>
              <tbody>
                {replies.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <span className="primary">
                        {row.linkedinUrl ? (
                          <a href={row.linkedinUrl} target="_blank" rel="noreferrer">
                            {row.name || "Unnamed"}
                          </a>
                        ) : (
                          row.name || "Unnamed"
                        )}
                      </span>
                      {row.role && <span className="sub">{row.role}</span>}
                    </td>
                    <td>{row.company || "—"}</td>
                    <td>{row.campaign || "—"}</td>
                    <td className="num">{shortDate(row.lastMessageAt)}</td>
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
    <Suspense fallback={<div className="loading">Loading…</div>}>
      <Shell>
        <Replies />
      </Shell>
    </Suspense>
  );
}
