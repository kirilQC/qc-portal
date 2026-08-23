// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { Suspense, useMemo, useState } from "react";
import ClientHead from "../../components/ClientHead";
import { usePortal, type Campaign } from "../../components/usePortal";
import "./campaigns.css";

/**
 * Campaigns as funnels rather than as a row of numbers.
 *
 * ── What the bar is ────────────────────────────────────────────────────────────────────────────
 * The whole bar is the campaign's audience — every lead loaded into it — and the five segments are the
 * stages that audience passed through: never contacted, contacted, accepted, replied, replied warmly.
 * Drawn this way a campaign with three thousand leads and two hundred sent looks visibly unfinished,
 * which a table of rates cannot show at all.
 *
 * Each bar is proportional to its own audience rather than the largest campaign's. Two rows are
 * therefore comparable in shape but not in width — the honest trade, since the alternative reduces
 * every small campaign to a sliver. The audience size is stated beside the name so it is never in doubt.
 */
type Sort = "launched" | "oldest" | "reach" | "acceptance" | "reply" | "positive" | "name";

const SORTS: [Sort, string][] = [
  ["launched", "Newest launch"],
  ["oldest", "Oldest launch"],
  ["reach", "Most reached"],
  ["acceptance", "Acceptance rate"],
  ["reply", "Reply rate"],
  ["positive", "Positive rate"],
  ["name", "Name A–Z"],
];

function Campaigns() {
  const { data, error, loading } = usePortal();
  const [sort, setSort] = useState<Sort>("launched");

  const campaigns = data?.campaigns ?? [];

  const sorted = useMemo(() => {
    const rows = [...campaigns];
    const launched = (row: Campaign) => (row.launchedAt ? Date.parse(row.launchedAt) : 0);
    switch (sort) {
      case "oldest":
        // Campaigns with no launch date sink rather than leading, where they would look like the oldest.
        return rows.sort((a, b) => (launched(a) || Infinity) - (launched(b) || Infinity));
      case "reach":
        return rows.sort((a, b) => b.connectionsSent - a.connectionsSent);
      case "acceptance":
        return rows.sort((a, b) => b.acceptanceRate - a.acceptanceRate);
      case "reply":
        return rows.sort((a, b) => b.replyRate - a.replyRate);
      case "positive":
        return rows.sort((a, b) => b.positiveReplyRate - a.positiveReplyRate);
      case "name":
        return rows.sort((a, b) => a.name.localeCompare(b.name));
      default:
        return rows.sort((a, b) => launched(b) - launched(a));
    }
  }, [campaigns, sort]);

  if (loading) return <div className="content"><p className="loading">Loading…</p></div>;
  if (error) return <div className="content"><p className="error-note">{error}</p></div>;
  if (data?.view === "directory") return <div className="content"><p className="empty">Pick a client first.</p></div>;

  const client = data?.client;
  if (!client) return <div className="content"><p className="empty">Nothing to show yet.</p></div>;

  const totals = campaigns.reduce(
    (sum, row) => ({
      leads: sum.leads + Math.max(row.totalLeads, row.connectionsSent),
      sent: sum.sent + row.connectionsSent,
      accepted: sum.accepted + row.connectionsAccepted,
      replies: sum.replies + row.replies,
      positive: sum.positive + row.positiveReplies,
      scored: sum.scored + row.scoredReplies,
    }),
    { leads: 0, sent: 0, accepted: 0, replies: 0, positive: 0, scored: 0 },
  );
  const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

  return (
    <div className="content">
      <ClientHead client={client} />

      <div className="cmp-bench">
        <span><b>{totals.leads.toLocaleString()}</b> leads</span>
        <span><b>{totals.sent.toLocaleString()}</b> reached</span>
        <span>acceptance <b>{pct(totals.accepted, totals.sent)}%</b></span>
        <span>reply rate <b>{pct(totals.replies, totals.accepted)}%</b></span>
        <span>positive <b>{pct(totals.positive, totals.accepted)}%</b></span>
      </div>

      {/*
        * The coverage warning, shown only when it is actually true.
        *
        * Sentiment scoring started partway through this account, so a campaign from before it has
        * replies nobody classified — and a 0% positive rate on a strong old campaign is a number a
        * client would draw exactly the wrong conclusion from. Saying so once, at the top, is cheaper
        * than explaining it every time somebody asks.
        */}
      {totals.replies > 0 && totals.scored < totals.replies * 0.9 && (
        <p className="cmp-caveat">
          Sentiment analysis has classified <b>{totals.scored.toLocaleString()}</b> of{" "}
          <b>{totals.replies.toLocaleString()}</b> replies. Campaigns that ran before scoring was
          switched on show a low or blank positive rate because their replies were never classified —
          not because the replies were poor.
        </p>
      )}

      <div className="panel">
        <div className="panel-head">
          <h2>Campaigns</h2>
          <div className="cmp-tools">
            <span>{campaigns.length} total</span>
            <label className="cmp-sort">
              <span>Sort</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
                {SORTS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="cmp-legend">
          <span><i className="k-untouched" />Not contacted</span>
          <span><i className="k-reached" />Reached</span>
          <span><i className="k-accepted" />Accepted</span>
          <span><i className="k-replied" />Replied</span>
          <span><i className="k-positive" />Positive</span>
        </div>

        {sorted.length === 0 ? (
          <p className="empty">No campaigns yet.</p>
        ) : (
          <div className="cmp-rows">
            {sorted.map((row) => (
              <CampaignRow key={row.campaignId || row.name} row={row} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CampaignRow({ row }: { row: Campaign }) {
  /*
   * The audience the bar represents.
   *
   * `total_leads` is what was loaded into the campaign, but HeyReach sometimes reports fewer leads than
   * requests sent once a list has been edited — so the larger of the two is used. A bar that a segment
   * overflows would be worse than a slightly generous denominator.
   */
  const audience = Math.max(row.totalLeads, row.connectionsSent, 1);

  const positive = Math.min(row.positiveReplies, row.replies);
  const repliedOnly = Math.max(0, row.replies - positive);
  const acceptedOnly = Math.max(0, row.connectionsAccepted - row.replies);
  const reachedOnly = Math.max(0, row.connectionsSent - row.connectionsAccepted);
  const untouched = Math.max(0, audience - row.connectionsSent);

  const share = (value: number) => (value / audience) * 100;
  const launched = row.launchedAt
    ? new Date(row.launchedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;
  const running = (row.status ?? "").toLowerCase() === "active";
  /** No reply of this campaign's has ever been classified, so its positive rate means nothing yet. */
  const unscored = row.replies > 0 && row.scoredReplies === 0;

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
            <b>{audience.toLocaleString()}</b> leads
            {row.senders.length > 0 ? ` · ${row.senders.join(", ")}` : ""}
          </p>
        </div>

        <div className="cmp-rates">
          <Rate label="Acceptance" value={`${row.acceptanceRate}%`} sub={`${row.connectionsAccepted.toLocaleString()} of ${row.connectionsSent.toLocaleString()}`} />
          <Rate label="Reply rate" value={`${row.replyRate}%`} sub={`${row.replies.toLocaleString()} replies`} />
          <Rate
            label="Positive"
            value={unscored ? "—" : `${row.positiveReplyRate}%`}
            sub={unscored ? "not scored yet" : `${positive.toLocaleString()} positive`}
            tone={unscored ? "muted" : "positive"}
          />
        </div>
      </header>

      <div
        className="cmp-funnel"
        role="img"
        aria-label={`${audience} leads, ${row.connectionsSent} reached, ${row.connectionsAccepted} accepted, ${row.replies} replied, ${positive} positive`}
      >
        {untouched > 0 && <span className="k-untouched" style={{ width: `${share(untouched)}%` }} title={`${untouched.toLocaleString()} not contacted yet`} />}
        {reachedOnly > 0 && <span className="k-reached" style={{ width: `${share(reachedOnly)}%` }} title={`${reachedOnly.toLocaleString()} reached, not accepted`} />}
        {acceptedOnly > 0 && <span className="k-accepted" style={{ width: `${share(acceptedOnly)}%` }} title={`${acceptedOnly.toLocaleString()} accepted, no reply`} />}
        {repliedOnly > 0 && <span className="k-replied" style={{ width: `${share(repliedOnly)}%` }} title={`${repliedOnly.toLocaleString()} replied`} />}
        {positive > 0 && <span className="k-positive" style={{ width: `${share(positive)}%` }} title={`${positive.toLocaleString()} replied positively`} />}
      </div>
    </article>
  );
}

function Rate({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className={`cmp-rate ${tone ?? ""}`}>
      <span className="cmp-rate-label">{label}</span>
      <strong>{value}</strong>
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
