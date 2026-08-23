// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { Suspense } from "react";
import Shell from "../components/Shell";
import ClientHead from "../components/ClientHead";
import { dateTime, usePortal } from "../components/usePortal";

/** Every meeting booked, upcoming first — for most clients this is the number that matters. */
function Meetings() {
  const { data, error, loading } = usePortal();

  if (loading) return <div className="content"><p className="loading">Loading…</p></div>;
  if (error) return <div className="content"><p className="error-note">{error}</p></div>;
  if (data?.view === "directory") return <div className="content"><p className="empty">Pick a client first.</p></div>;

  const client = data?.client;
  const meetings = data?.meetings ?? [];
  if (!client) return <div className="content"><p className="empty">Nothing to show yet.</p></div>;

  const now = Date.now();
  const upcoming = meetings.filter((row) => row.meetingAt && Date.parse(row.meetingAt) > now);
  const past = meetings.filter((row) => !row.meetingAt || Date.parse(row.meetingAt) <= now);

  const table = (rows: typeof meetings, showPill: boolean) => (
    <div className="table-wrap">
      <table className="rows">
        <thead>
          <tr>
            <th>Who</th>
            <th>Company</th>
            <th>Campaign</th>
            <th className="num">When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <span className="primary">
                  {row.inviteeLinkedin ? (
                    <a href={row.inviteeLinkedin} target="_blank" rel="noreferrer">{row.inviteeName || "Unnamed"}</a>
                  ) : (
                    row.inviteeName || "Unnamed"
                  )}
                </span>
                {row.inviteeTitle && <span className="sub">{row.inviteeTitle}</span>}
              </td>
              <td>
                {row.companyName || "—"}
                {row.companyIndustry && <span className="sub">{row.companyIndustry}</span>}
              </td>
              <td>{row.campaign || "—"}</td>
              <td className="num">
                {showPill && <span className="pill upcoming">Upcoming</span>}{" "}
                {row.meetingAt ? dateTime(row.meetingAt) : row.whenText || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="content">
      <ClientHead client={client} sub="Meetings booked" />

      <div className="panel">
        <div className="panel-head">
          <h2>Upcoming</h2>
          <span>{upcoming.length}</span>
        </div>
        {upcoming.length === 0 ? <p className="empty">Nothing on the calendar right now.</p> : table(upcoming, true)}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Past meetings</h2>
          <span>{past.length}</span>
        </div>
        {past.length === 0 ? <p className="empty">No past meetings yet.</p> : table(past, false)}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="loading">Loading…</div>}>
      <Shell>
        <Meetings />
      </Shell>
    </Suspense>
  );
}
