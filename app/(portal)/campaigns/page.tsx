// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { Suspense } from "react";
import ClientHead from "../../components/ClientHead";
import { usePortal, type Campaign } from "../../components/usePortal";
import "./campaigns.css";

/**
 * Campaigns as funnels rather than as a row of numbers.
 *
 * ── Why a bar and not five columns ──────────────────────────────────────────────────────────────
 * The table this replaced gave every figure the same weight, so the one thing a person actually wants
 * from this screen — which campaigns are carrying the account — had to be worked out by reading and
 * comparing. Drawn as a proportional bar, the drop-off has a shape: a campaign that reaches two
 * thousand people and converts almost none of them looks visibly different from one that reaches few
 * and converts well, before a single number is read.
 *
 * ── What the bar is proportional to ─────────────────────────────────────────────────────────────
 * Each campaign's own reach, not the largest campaign's. Two rows are therefore comparable in *shape*
 * but not in width, which is the honest trade: the alternative makes every small campaign a sliver and
 * answers a question nobody asked. Reach is stated as a figure beside the name so the size is never in
 * doubt.
 */
function Campaigns() {
  const { data, error, loading } = usePortal();

  if (loading) return <div className="content"><p className="loading">Loading…</p></div>;
  if (error) return <div className="content"><p className="error-note">{error}</p></div>;
  if (data?.view === "directory") return <div className="content"><p className="empty">Pick a client first.</p></div>;

  const client = data?.client;
  const campaigns = data?.campaigns ?? [];
  if (!client) return <div className="content"><p className="empty">Nothing to show yet.</p></div>;

  // The portfolio averages, so a row can be read against the account rather than in isolation.
  const totals = campaigns.reduce(
    (sum, row) => ({
      sent: sum.sent + row.connectionsSent,
      accepted: sum.accepted + row.connectionsAccepted,
      replies: sum.replies + row.replies,
      positive: sum.positive + row.positiveReplies,
    }),
    { sent: 0, accepted: 0, replies: 0, positive: 0 },
  );
  const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

  return (
    <div className="content">
      <ClientHead client={client} />

      <div className="cmp-bench">
        <span>Portfolio · <b>{totals.sent.toLocaleString()}</b> reached</span>
        <span>acceptance <b>{pct(totals.accepted, totals.sent)}%</b></span>
        <span>reply rate <b>{pct(totals.replies, totals.accepted)}%</b></span>
        <span>positive <b>{pct(totals.positive, totals.accepted)}%</b></span>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Campaigns</h2>
          <span>{campaigns.length} total · sorted by reach</span>
        </div>

        <div className="cmp-legend">
          <span><i className="k-none" />No response</span>
          <span><i className="k-accepted" />Accepted</span>
          <span><i className="k-replied" />Replied</span>
          <span><i className="k-positive" />Positive</span>
        </div>

        {campaigns.length === 0 ? (
          <p className="empty">No campaigns yet.</p>
        ) : (
          <div className="cmp-rows">
            {campaigns.map((row) => (
              <CampaignRow key={row.campaignId || row.name} row={row} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CampaignRow({ row }: { row: Campaign }) {
  const reached = Math.max(row.connectionsSent, 1);
  // The four segments, as shares of this campaign's own reach. Positives are drawn inside the replies
  // they are part of, so the segments sum to the whole rather than double-counting.
  const positive = Math.min(row.positiveReplies, row.replies);
  const otherReplies = Math.max(0, row.replies - positive);
  const acceptedNoReply = Math.max(0, row.connectionsAccepted - row.replies);
  const noResponse = Math.max(0, reached - row.connectionsAccepted);

  const share = (value: number) => (value / reached) * 100;
  const launched = row.launchedAt
    ? new Date(row.launchedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;
  const running = (row.status ?? "").toLowerCase() === "active";

  return (
    <article className="cmp-row">
      <header className="cmp-row-head">
        <div className="cmp-id">
          <h3>
            {row.name || "Untitled campaign"}
            {running && <span className="pill active">Running</span>}
          </h3>
          <p>
            {launched ? `Launched ${launched}` : "Launch date not recorded"}
            {" · "}
            <b>{row.connectionsSent.toLocaleString()}</b> reached
            {row.senders.length > 0 && (
              <>
                {" · "}
                {row.senders.join(", ")}
              </>
            )}
          </p>
        </div>

        <div className="cmp-rates">
          <Rate label="Acceptance" value={row.acceptanceRate} sub={`${row.connectionsAccepted.toLocaleString()} accepted`} />
          <Rate label="Reply rate" value={row.replyRate} sub={`${row.replies.toLocaleString()} replies`} />
          <Rate label="Positive" value={row.positiveReplyRate} sub={`${positive.toLocaleString()} positive`} tone="positive" />
        </div>
      </header>

      <div
        className="cmp-funnel"
        role="img"
        aria-label={`${row.connectionsSent} reached, ${row.connectionsAccepted} accepted, ${row.replies} replied, ${positive} positive`}
      >
        {noResponse > 0 && (
          <span className="k-none" style={{ width: `${share(noResponse)}%` }} title={`${noResponse.toLocaleString()} no response`} />
        )}
        {acceptedNoReply > 0 && (
          <span className="k-accepted" style={{ width: `${share(acceptedNoReply)}%` }} title={`${acceptedNoReply.toLocaleString()} accepted, no reply`} />
        )}
        {otherReplies > 0 && (
          <span className="k-replied" style={{ width: `${share(otherReplies)}%` }} title={`${otherReplies.toLocaleString()} replied`} />
        )}
        {positive > 0 && (
          <span className="k-positive" style={{ width: `${share(positive)}%` }} title={`${positive.toLocaleString()} positive`} />
        )}
      </div>
    </article>
  );
}

function Rate({ label, value, sub, tone }: { label: string; value: number; sub: string; tone?: string }) {
  return (
    <div className={`cmp-rate ${tone ?? ""}`}>
      <span className="cmp-rate-label">{label}</span>
      <strong>{value}%</strong>
      <small>{sub}</small>
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
