// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";
/* eslint-disable react-hooks/set-state-in-effect -- the load happens on mount and on client change;
   the setState calls sit inside async callbacks rather than the effect body. */

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import "./inbox.css";

/**
 * The inbox, reproduced from Reply Radar: five metrics, the reply queue, and the conversation pane.
 *
 * Same columns, same score pills, same bubbles, same AI-draft box — with one difference that is
 * deliberate rather than unfinished: **there is no send button.** A reply from here would go out under a
 * QC sender's name to a real person; that is an outward action that belongs in the tool built to take
 * responsibility for it. The draft is shown because it is part of the record; it just cannot be fired.
 */
type Message = { id: string; body: string; direction: string; sentAt: string; authorName: string };
type Lead = {
  id: string; leadId: string; initials: string; name: string; role: string; company: string;
  profileUrl: string | null; photoUrl: string | null; companyPhotoUrl: string | null;
  headline: string | null; industry: string | null; enriched: boolean;
  campaignName: string | null; senderName: string;
  leadScore: number | null; icpReason: string | null;
  score: number; tier: "hot" | "warm" | "nurture"; reason: string;
  sentiment: string | null; cachedDraft: string | null; cachedReason: string | null;
  preview: string; age: string; lastMessageAt: string; latestReplyAt: string;
  lastRefreshedAt: string | null; replies: number; messages: Message[];
};

type Filter = "today" | "week" | "all" | "follow-ups";
type View = "queue" | "analytics";

const FILTERS: [string, Filter][] = [
  ["Today", "today"],
  ["This week", "week"],
  ["All replies", "all"],
  ["Follow-ups", "follow-ups"],
];

/** Reply Radar's bands for the urgency pill. */
const band = (score: number): "hot" | "warm" | "cold" | "nurture" => {
  if (score >= 75) return "hot";
  if (score >= 50) return "warm";
  if (score >= 25) return "cold";
  return "nurture";
};

function dateParts(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "—", time: "" };
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return { date: "—", time: "" };
  return {
    date: value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    time: value.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
  };
}

function Avatar({ src, alt, fallback }: { src?: string | null; alt: string; fallback: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <>{fallback}</>;
  return <img src={src} alt={alt} onError={() => setFailed(true)} />;
}

function Inbox() {
  const params = useSearchParams();
  const clientSlug = params.get("client");

  const [leads, setLeads] = useState<Lead[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(10);
  const [campaignFilter, setCampaignFilter] = useState("");
  const [senderFilter, setSenderFilter] = useState("");
  const [sentimentFilter, setSentimentFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState<View>("queue");
  const threadEnd = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLoaded(false);
    void (async () => {
      try {
        const query = clientSlug ? `?client=${encodeURIComponent(clientSlug)}` : "";
        const response = await fetch(`/api/inbox${query}`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError(payload.error || "The inbox did not load.");
          return;
        }
        setLeads(payload.conversations ?? []);
        setError("");
      } catch {
        setError("The inbox did not load.");
      } finally {
        setLoaded(true);
      }
    })();
  }, [clientSlug]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const weekStart = todayStart - now.getDay() * 86_400_000;

    return leads
      .filter((lead) => {
        if (needle) {
          const haystack = [lead.name, lead.company, lead.role, lead.campaignName, lead.senderName]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(needle)) return false;
        }
        if (campaignFilter && lead.campaignName !== campaignFilter) return false;
        if (senderFilter && lead.senderName !== senderFilter) return false;
        if (sentimentFilter && lead.sentiment !== sentimentFilter) return false;

        const when = Date.parse(lead.latestReplyAt || lead.lastMessageAt);
        if (filter === "today") return when >= todayStart;
        if (filter === "week") return when >= weekStart;
        if (filter === "follow-ups") return lead.score > 0;
        return true;
      })
      .sort((a, b) =>
        filter === "follow-ups"
          ? b.score - a.score
          : Date.parse(b.latestReplyAt || b.lastMessageAt) - Date.parse(a.latestReplyAt || a.lastMessageAt),
      );
  }, [leads, search, filter, campaignFilter, senderFilter, sentimentFilter]);

  const current = filtered.find((lead) => lead.id === selectedId) ?? filtered[0] ?? null;

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: "end" });
  }, [current?.id]);

  // The five metrics, computed from what is on screen, exactly as Reply Radar computes them.
  const totalReplies = filtered.reduce((sum, lead) => sum + lead.replies, 0);
  const needsReply = filtered.filter((lead) => lead.messages.at(-1)?.direction === "inbound").length;
  const positive = filtered.filter((lead) => lead.sentiment === "positive").length;
  const scored = filtered.filter((lead) => lead.sentiment).length;
  const positiveRate = scored ? ((positive / scored) * 100).toFixed(1) : "0.0";
  const rangeWord = filter === "today" ? "today" : filter === "week" ? "this week" : filter === "follow-ups" ? "needing follow-up" : "all time";

  /**
   * The analytics view, derived from exactly the rows the queue is showing.
   *
   * Deliberately computed from `filtered` rather than from the whole set: if the filter says "this
   * week", the chart says this week too. Analytics that quietly ignore the filter above them are how
   * two numbers on one screen end up disagreeing.
   */
  const analytics = useMemo(() => {
    const byDay = new Map<string, number>();
    const byCampaign = new Map<string, number>();
    const bySender = new Map<string, number>();
    const sentiment = { positive: 0, neutral: 0, negative: 0, unscored: 0 };

    for (const lead of filtered) {
      const day = (lead.latestReplyAt || lead.lastMessageAt || "").slice(0, 10);
      if (day) byDay.set(day, (byDay.get(day) ?? 0) + lead.replies);
      const campaign = lead.campaignName || "No campaign";
      byCampaign.set(campaign, (byCampaign.get(campaign) ?? 0) + lead.replies);
      bySender.set(lead.senderName, (bySender.get(lead.senderName) ?? 0) + lead.replies);
      const key = (lead.sentiment ?? "") as keyof typeof sentiment;
      if (key === "positive" || key === "neutral" || key === "negative") sentiment[key] += 1;
      else sentiment.unscored += 1;
    }

    const top = (map: Map<string, number>, limit: number) =>
      [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);

    return {
      days: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-30),
      campaigns: top(byCampaign, 10),
      senders: top(bySender, 10),
      sentiment,
    };
  }, [filtered]);

  const options = (pick: (lead: Lead) => string | null) =>
    [...new Set(leads.map(pick).filter((value): value is string => Boolean(value)))].sort();

  if (!clientSlug && error) {
    return <div className="content"><p className="empty">Pick a client from the directory first.</p></div>;
  }

  return (
    <div className="inbox-wrap">
      {error && <p className="error-note" style={{ margin: "20px 32px 0" }}>{error}</p>}

      <div className="inbox-metrics">
        <Metric label={`Replies ${rangeWord}`} value={String(totalReplies)} tone="purple" note={`Replies ${rangeWord}`} />
        <Metric label={`Number of leads needing reply ${rangeWord}`} value={String(needsReply)} tone="coral" note="Leads waiting on us" />
        <Metric label="Conversations" value={String(filtered.length)} tone="amber" note={`Threads ${rangeWord}`} />
        <Metric label="Positive replies" value={String(positive)} tone="green" note="From our sentiment analysis" />
        <Metric label={`Positive reply rate ${rangeWord}`} value={`${positiveRate}%`} tone="green" note="Of replies we scored" />
      </div>

      <div className="inbox-bar">
        <div className="inbox-title-row">
          <h2 className="inbox-title">{view === "queue" ? "Reply queue" : "Analytics"} <b>{filtered.length}</b></h2>
          <div className="segmented view-toggle">
            <button className={view === "queue" ? "selected" : ""} onClick={() => setView("queue")}>Queue</button>
            <button className={view === "analytics" ? "selected" : ""} onClick={() => setView("analytics")}>Analytics</button>
          </div>
        </div>
        <div className="inbox-controls">
          <label className="inbox-search">
            <span>⌕</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, company, campaign" />
          </label>
          <div className="segmented">
            {FILTERS.map(([label, value]) => (
              <button key={value} className={filter === value ? "selected" : ""} onClick={() => { setFilter(value); setSelectedId(""); }}>
                {label}
              </button>
            ))}
          </div>
          <div className="filter-wrap">
            <button className="filter-button" onClick={() => setFiltersOpen((open) => !open)}>
              Filters{campaignFilter || senderFilter || sentimentFilter ? " ●" : ""}
            </button>
            {filtersOpen && (
              <div className="filter-dropdown">
                <Picker label="Campaign" value={campaignFilter} onPick={setCampaignFilter} values={options((l) => l.campaignName)} />
                <Picker label="Sender" value={senderFilter} onPick={setSenderFilter} values={options((l) => l.senderName)} />
                <Picker label="Sentiment" value={sentimentFilter} onPick={setSentimentFilter} values={["positive", "neutral", "negative"]} />
                <button
                  className="filter-clear"
                  onClick={() => { setCampaignFilter(""); setSenderFilter(""); setSentimentFilter(""); setFiltersOpen(false); }}
                >
                  Clear all filters
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {view === "analytics" ? (
        <div className="analytics-grid">
          <div className="panel">
            <div className="panel-head"><h2>Replies by day</h2><span>Last 30 days with activity</span></div>
            {analytics.days.length === 0 ? <p className="empty">Nothing in range.</p> : (
              <>
                <div className="chart">
                  {analytics.days.map(([day, count]) => (
                    <div key={day} className="chart-col" title={`${day}: ${count} repl${count === 1 ? "y" : "ies"}`}>
                      <div className="chart-bar" style={{ height: `${(count / Math.max(1, ...analytics.days.map((d) => d[1]))) * 100}%` }} />
                    </div>
                  ))}
                </div>
                <div className="chart-legend"><span><b style={{ background: "var(--accent)" }} />Replies</span></div>
              </>
            )}
          </div>

          <div className="panel">
            <div className="panel-head"><h2>Sentiment</h2><span>Of replies we scored</span></div>
            <div className="sentiment-bars">
              {([["positive", "var(--green)"], ["neutral", "var(--amber)"], ["negative", "var(--coral)"], ["unscored", "var(--muted-2)"]] as const).map(([key, color]) => {
                const value = analytics.sentiment[key];
                const total = Math.max(1, filtered.length);
                return (
                  <div key={key} className="sentiment-row">
                    <span className="sentiment-name">{key}</span>
                    <span className="sentiment-track"><span style={{ width: `${(value / total) * 100}%`, background: color }} /></span>
                    <span className="sentiment-value">{value}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><h2>Replies by campaign</h2><span>Top 10</span></div>
            <Bars rows={analytics.campaigns} />
          </div>

          <div className="panel">
            <div className="panel-head"><h2>Replies by sender</h2><span>Top 10</span></div>
            <Bars rows={analytics.senders} />
          </div>
        </div>
      ) : (
      <div className="inbox-grid">
        <div className="queue-card">
          <div className="queue-scroll">
          <div className="table-head">
            <span>LEAD</span><span>CAMPAIGN</span><span>LATEST REPLY</span>
            <span>SENDER</span><span>REPLIES</span><span>LEAD SCORE</span>
          </div>
          {!loaded ? (
            <p className="loading">Loading conversations…</p>
          ) : filtered.length === 0 ? (
            <p className="empty">No conversations match.</p>
          ) : (
            <>
              {filtered.slice(0, visible).map((lead) => {
                const when = dateParts(lead.latestReplyAt);
                return (
                  <div
                    key={lead.id}
                    className={`lead-row ${current?.id === lead.id ? "row-selected" : ""} ${lead.sentiment ? `row-sentiment-${lead.sentiment}` : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedId(lead.id)}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(lead.id); } }}
                  >
                    <div className="lead-main">
                      <div className="lead-avatar">
                        <Avatar src={lead.photoUrl} alt={lead.name} fallback={lead.initials} />
                      </div>
                      <div className="lead-words">
                        <strong className="lead-name">
                          <span>{lead.name}</span>
                          {lead.messages.at(-1)?.direction === "outbound" && (
                            <span className="responded-check" title="Already replied">✓</span>
                          )}
                        </strong>
                        <span>{[lead.role, lead.company].filter(Boolean).join(" @ ") || "No title or company"}</span>
                      </div>
                    </div>
                    <div className="cell"><strong>{lead.campaignName || "No campaign"}</strong></div>
                    <div className="cell"><strong>{when.date}</strong><span>{when.time}</span></div>
                    <div className="cell"><strong>{lead.senderName}</strong></div>
                    <div className="cell num"><strong>{lead.replies}</strong></div>
                    <div className="cell num"><strong>{lead.leadScore ?? "—"}</strong></div>
                  </div>
                );
              })}
              {filtered.length > visible && (
                <button className="see-more" onClick={() => setVisible((count) => count + 10)}>
                  Show 10 more leads <span>{filtered.length - visible} left</span>
                </button>
              )}
            </>
          )}
          </div>
        </div>

        <aside className="detail-card">
          {!current ? (
            <p className="empty">No conversation selected.</p>
          ) : (
            <>
              <div className="detail-top">
                <div className="detail-person">
                  <div className="large-avatar">
                    <Avatar src={current.photoUrl} alt={current.name} fallback={current.initials} />
                  </div>
                  <div className="detail-words">
                    <h3>
                      {current.name}
                      {current.messages.at(-1)?.direction === "outbound" && (
                        <span className="responded-check" title="Already replied">✓</span>
                      )}
                    </h3>
                    <p>{[current.role, current.company].filter(Boolean).join(" at ")}</p>
                    {current.profileUrl && (
                      <a className="linkedin" href={current.profileUrl} target="_blank" rel="noreferrer">
                        in&nbsp; LinkedIn profile ↗
                      </a>
                    )}
                  </div>
                  {current.companyPhotoUrl && (
                    <img className="company-logo" src={current.companyPhotoUrl} alt={`${current.company} logo`} />
                  )}
                </div>

                <div className="detail-tags">
                  <span className={`score-pill ${band(current.score)}`}>
                    {current.score} · {band(current.score)}
                  </span>
                  {current.campaignName && <span className="tag-outline">{current.campaignName}</span>}
                  {current.sentiment && (
                    <span className={`sentiment-badge sentiment-${current.sentiment}`}>{current.sentiment}</span>
                  )}
                </div>

                {(current.headline || current.industry) && (
                  <p className="enrichment-summary">
                    {[current.headline, current.industry].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>

              <div className="thread">
                {current.messages.length === 0 ? (
                  <p className="empty">No messages yet.</p>
                ) : (
                  current.messages.map((message, index) => {
                    const isLatestInbound =
                      message.direction !== "outbound" &&
                      index === current.messages.map((m) => m.direction).lastIndexOf("inbound");
                    return (
                      <div
                        key={message.id}
                        className={`bubble ${message.direction === "outbound" ? "outbound" : "inbound"} ${isLatestInbound ? "latest-inbound" : ""}`}
                      >
                        {message.direction !== "outbound" && (
                          <span className="bubble-avatar">
                            <Avatar src={current.photoUrl} alt={current.name} fallback={current.initials} />
                          </span>
                        )}
                        <small className="message-author">{message.authorName}</small>
                        <p>{message.body}</p>
                        <time>{dateParts(message.sentAt).date} · {dateParts(message.sentAt).time}</time>
                      </div>
                    );
                  })
                )}
                <div ref={threadEnd} />
              </div>

              {/* The draft as it stands in the record. Read-only: see the note at the top of this file. */}
              <div className="composer">
                <div className="composer-top">
                  <span>AI DRAFT</span>
                  <em>read-only here</em>
                </div>
                <div className="composer-body">
                  {current.cachedDraft ? <p>{current.cachedDraft}</p> : <p className="composer-empty">No draft written for this conversation yet.</p>}
                </div>
                {current.cachedReason && (
                  <div className="reason-box">
                    <small>WHY THIS SCORE</small>
                    <p>{current.cachedReason}</p>
                  </div>
                )}
              </div>
            </>
          )}
        </aside>
      </div>
      )}
    </div>
  );
}

/** A ranked horizontal bar list — the shape that answers "which of these is biggest" fastest. */
function Bars({ rows }: { rows: [string, number][] }) {
  if (!rows.length) return <p className="empty">Nothing in range.</p>;
  const peak = Math.max(1, ...rows.map(([, value]) => value));
  return (
    <div className="bars">
      {rows.map(([label, value]) => (
        <div key={label} className="bar-row">
          <span className="bar-label" title={label}>{label}</span>
          <span className="bar-track"><span style={{ width: `${(value / peak) * 100}%` }} /></span>
          <span className="bar-value">{value}</span>
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${tone}`} />
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function Picker({ label, value, onPick, values }: { label: string; value: string; onPick: (next: string) => void; values: string[] }) {
  return (
    <div className="filter-group">
      <span className="filter-group-label">{label}</span>
      <button className={`filter-item ${!value ? "active" : ""}`} onClick={() => onPick("")}>All</button>
      {values.slice(0, 40).map((option) => (
        <button key={option} className={`filter-item ${value === option ? "active" : ""}`} onClick={() => onPick(option)}>
          {option}
        </button>
      ))}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Inbox />
    </Suspense>
  );
}
