// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { Suspense, useMemo, useState } from "react";
import ClientHead from "../../components/ClientHead";
import Timeline from "./Timeline";
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
  const [visible, setVisible] = useState(10);

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

  /*
   * The five headline figures.
   *
   * "Average" here is the mean of the per-campaign rates, unweighted — which is how Reply Radar
   * computes the same three numbers. It is not the pooled total (all accepted ÷ all sent): those two
   * differ, sometimes by several points, and a portal that quoted one while the internal tool quoted
   * the other would make every conversation about which screen to trust.
   */
  const mean = (pick: (row: Campaign) => number) =>
    campaigns.length ? Math.round((campaigns.reduce((sum, row) => sum + pick(row), 0) / campaigns.length) * 10) / 10 : 0;

  const reached = campaigns.reduce((sum, row) => sum + row.connectionsSent, 0);
  const headline = {
    launched: campaigns.length,
    reached,
    acceptance: mean((row) => row.acceptanceRate),
    reply: mean((row) => row.replyRate),
    positive: mean((row) => row.positiveReplyRate),
  };

  return (
    <div className="content cmp-wide">
      <ClientHead client={client} />

      <div className="cmp-headline">
        <Headline label="Campaigns launched" value={headline.launched.toLocaleString()} />
        <Headline label="Leads reached out to" value={headline.reached.toLocaleString()} />
        <Headline label="Average acceptance rate" value={`${headline.acceptance}%`} tone="accepted" />
        <Headline label="Average reply rate" value={`${headline.reply}%`} tone="replied" />
        <Headline label="Average positive reply rate" value={`${headline.positive}%`} tone="positive" />
      </div>

      <div className="panel">
        <div className="panel-head cmp-head">
          <h2>Campaigns</h2>
          <div className="cmp-tools">
            <select
              className="cmp-sort-select"
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
              aria-label="Sort campaigns"
            >
              {SORTS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
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
          <>
            <div className="cmp-rows">
              {sorted.slice(0, visible).map((row) => (
                <CampaignRow key={row.campaignId || row.name} row={row} />
              ))}
            </div>
            {sorted.length > visible && (
              <button className="cmp-more" onClick={() => setVisible((count) => count + 10)}>
                See 10 more
              </button>
            )}
          </>
        )}
      </div>

      {/* Every campaign, not just the ten on screen — a timeline with a page break in it is not one. */}
      <Timeline campaigns={campaigns} />
    </div>
  );
}

function CampaignRow({ row }: { row: Campaign }) {
  /*
   * The header still shows the whole list that was loaded ("165 leads").
   *
   * `total_leads` is what was loaded into the campaign, but HeyReach sometimes reports fewer leads than
   * requests sent once a list has been edited — so the larger of the two is used.
   */
  const listLeads = Math.max(row.totalLeads, row.connectionsSent, 1);

  /*
   * The funnel represents the *contactable* set: everyone already sent a request, plus everyone still
   * queued to be sent one (HeyReach's `pending`). "Not contacted" is exactly the pending count — the leads
   * still waiting to be reached — NOT `list − sent`, because a HeyReach list also holds leads it will never
   * contact (already connected, out of network, duplicates, filtered), which are not "yet to contact" and
   * kept the band full even on a finished campaign sitting at 0 pending.
   */
  const untouched = Math.max(0, row.pending);
  const reachable = Math.max(row.connectionsSent + untouched, 1);

  const positive = Math.min(row.positiveReplies, row.replies);
  const repliedOnly = Math.max(0, row.replies - positive);
  const acceptedOnly = Math.max(0, row.connectionsAccepted - row.replies);
  const reachedOnly = Math.max(0, row.connectionsSent - row.connectionsAccepted);

  const share = (value: number) => (value / reachable) * 100;
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
            <b>{listLeads.toLocaleString()}</b> leads
            {row.senders.length > 0 ? ` · ${row.senders.join(", ")}` : ""}
          </p>
        </div>

        <div className="cmp-rates">
          {/* Each figure wears the colour of the band it describes, so a number and its segment are
              the same thing rather than two things to correlate. */}
          <Rate label="Acceptance" value={`${row.acceptanceRate}%`} sub={`${row.connectionsAccepted.toLocaleString()} of ${row.connectionsSent.toLocaleString()}`} tone="accepted" />
          <Rate label="Reply rate" value={`${row.replyRate}%`} sub={`${row.replies.toLocaleString()} replies`} tone="replied" />
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
        aria-label={`${untouched} not contacted, ${row.connectionsSent} reached, ${row.connectionsAccepted} accepted, ${row.replies} replied, ${positive} positive`}
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

/** One headline figure above the table. */
function Headline({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`cmp-headline-card ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
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
