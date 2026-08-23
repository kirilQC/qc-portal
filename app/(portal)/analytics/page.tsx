// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";
/* eslint-disable react-hooks/set-state-in-effect -- loads on mount and when the client changes; the
   setState calls sit inside an async callback rather than the effect body. */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import "../inbox/inbox.css";
import "./analytics.css";

/**
 * The client's outbound performance, on its own page.
 *
 * It lived inside the inbox as a second view, which was wrong: analytics is not a way of looking at the
 * reply queue, it is a different question about the same programme, and burying it behind a toggle on
 * another page means nobody finds it. It reads the same conversations the inbox does, so the two can
 * never state different totals.
 */
type Lead = {
  id: string; name: string; company: string; campaignName: string | null; senderName: string;
  sentiment: string | null; replies: number; lastMessageAt: string; latestReplyAt: string;
  messages: { direction: string; sentAt: string }[];
};

function Analytics() {
  const params = useSearchParams();
  const clientSlug = params.get("client");

  const [leads, setLeads] = useState<Lead[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [days, setDays] = useState(30);
  /**
   * "Now", pinned once on mount.
   *
   * Reading the clock during render makes the result depend on when React happened to re-render, so a
   * chart could shift under a hover. Fixed at mount, the window only moves when the page is reloaded or
   * the range is changed — which is what a person reading it would expect anyway.
   */
  const [now, setNow] = useState(0);
  useEffect(() => setNow(Date.now()), []);

  useEffect(() => {
    setLoaded(false);
    void (async () => {
      try {
        const query = clientSlug ? `?client=${encodeURIComponent(clientSlug)}` : "";
        const response = await fetch(`/api/inbox${query}`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError(payload.error || "Analytics did not load.");
          return;
        }
        setLeads(payload.conversations ?? []);
        setError("");
      } catch {
        setError("Analytics did not load.");
      } finally {
        setLoaded(true);
      }
    })();
  }, [clientSlug]);

  const stats = useMemo(() => {
    const since = (now || 0) - days * 86_400_000;
    const inRange = leads.filter((lead) => Date.parse(lead.latestReplyAt || lead.lastMessageAt) >= since);

    const byDay = new Map<string, number>();
    const byCampaign = new Map<string, number>();
    const bySender = new Map<string, number>();
    const sentiment = { positive: 0, neutral: 0, negative: 0, unscored: 0 };

    for (const lead of inRange) {
      const day = (lead.latestReplyAt || lead.lastMessageAt || "").slice(0, 10);
      if (day) byDay.set(day, (byDay.get(day) ?? 0) + lead.replies);
      byCampaign.set(lead.campaignName || "No campaign", (byCampaign.get(lead.campaignName || "No campaign") ?? 0) + lead.replies);
      bySender.set(lead.senderName, (bySender.get(lead.senderName) ?? 0) + lead.replies);
      const key = (lead.sentiment ?? "") as keyof typeof sentiment;
      if (key === "positive" || key === "neutral" || key === "negative") sentiment[key] += 1;
      else sentiment.unscored += 1;
    }

    const top = (map: Map<string, number>) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const scored = sentiment.positive + sentiment.neutral + sentiment.negative;

    return {
      conversations: inRange.length,
      replies: inRange.reduce((sum, lead) => sum + lead.replies, 0),
      awaiting: inRange.filter((lead) => lead.messages.at(-1)?.direction === "inbound").length,
      positiveRate: scored ? Math.round((sentiment.positive / scored) * 1000) / 10 : 0,
      days: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      campaigns: top(byCampaign),
      senders: top(bySender),
      sentiment,
      scored,
    };
  }, [leads, days, now]);

  if (!clientSlug && error) {
    return <div className="content"><p className="empty">Pick a client from the directory first.</p></div>;
  }

  const peak = Math.max(1, ...stats.days.map(([, value]) => value));

  return (
    <div className="inbox-wrap">
        <div className="inbox-bar">
          <h2 className="inbox-title">Analytics</h2>
          <div className="segmented">
            {[7, 30, 90].map((option) => (
              <button key={option} className={days === option ? "selected" : ""} onClick={() => setDays(option)}>
                {option} days
              </button>
            ))}
          </div>
        </div>

        {error && <p className="error-note">{error}</p>}
        {!loaded && <p className="loading">Loading…</p>}

        <div className="inbox-metrics">
          <Metric label="Conversations" value={stats.conversations.toLocaleString()} note={`In the last ${days} days`} tone="purple" />
          <Metric label="Replies received" value={stats.replies.toLocaleString()} note="Across those conversations" tone="green" />
          <Metric label="Waiting on a reply" value={stats.awaiting.toLocaleString()} note="They spoke last" tone="coral" />
          <Metric label="Positive reply rate" value={`${stats.positiveRate}%`} note={`Of ${stats.scored} scored`} tone="green" />
          <Metric label="Scored" value={`${stats.scored}/${stats.conversations}`} note="Replies we classified" tone="amber" />
        </div>

        <div className="analytics-grid">
          <div className="panel">
            <div className="panel-head"><h2>Replies by day</h2><span>Last {days} days</span></div>
            {stats.days.length === 0 ? <p className="empty">Nothing in range.</p> : (
              <>
                <div className="chart">
                  {stats.days.map(([day, count]) => (
                    <div key={day} className="chart-col" title={`${day}: ${count} repl${count === 1 ? "y" : "ies"}`}>
                      <div className="chart-bar" style={{ height: `${(count / peak) * 100}%` }} />
                    </div>
                  ))}
                </div>
                <div className="chart-legend"><span><b style={{ background: "var(--accent)" }} />Replies</span></div>
              </>
            )}
          </div>

          <div className="panel">
            <div className="panel-head"><h2>Sentiment</h2><span>How replies read</span></div>
            <div className="sentiment-bars">
              {([["positive", "var(--green)"], ["neutral", "var(--amber)"], ["negative", "var(--coral)"], ["unscored", "var(--muted-2)"]] as const).map(([key, color]) => (
                <div key={key} className="sentiment-row">
                  <span className="sentiment-name">{key}</span>
                  <span className="sentiment-track">
                    <span style={{ width: `${(stats.sentiment[key] / Math.max(1, stats.conversations)) * 100}%`, background: color }} />
                  </span>
                  <span className="sentiment-value">{stats.sentiment[key]}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><h2>Replies by campaign</h2><span>Top 10</span></div>
            <Bars rows={stats.campaigns} />
          </div>

          <div className="panel">
            <div className="panel-head"><h2>Replies by sender</h2><span>Top 10</span></div>
            <Bars rows={stats.senders} />
          </div>
      </div>
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

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Analytics />
    </Suspense>
  );
}
