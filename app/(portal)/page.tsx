// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";
/* eslint-disable react-hooks/set-state-in-effect -- loads on mount and when the client changes; the
   setState calls sit inside async callbacks rather than the effect body. */

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import "./overview.css";

/**
 * The client's overview: a month in a sentence, the trend behind it, and what has happened since.
 *
 * ── Why it opens with prose ─────────────────────────────────────────────────────────────────────
 * A client looks at this once a fortnight and wants to know how it is going. Five equal numbers make
 * them assemble that answer themselves, and the version this replaces led with "Meetings booked 0" and
 * "Attributed pipeline $0" — two zeros as the first impression of the work. A sentence says the same
 * thing faster and puts the empty figures where they belong: in a supporting row, stated honestly.
 *
 * ── Why the feed is here too ────────────────────────────────────────────────────────────────────
 * The sentence answers "how is it going". The feed answers "what has happened since I last looked",
 * which is the other question somebody opens a familiar page for. Nothing in the database records an
 * event, so it is assembled from replies, campaign launches and meetings — see the route for why that
 * is honest rather than clever.
 */
type Client = { id: string; name: string; slug: string; logoUrl: string | null; accentColor: string | null };
type FeedEvent = { kind: "reply" | "positive" | "launch" | "meeting"; at: string; title: string; detail: string };
type Payload = {
  ok: boolean; view: "client" | "directory"; error?: string;
  clients?: Client[]; client?: Client; startedAt?: string | null;
  window?: {
    days: number; reached: number; accepted: number; replies: number; scored: number; positive: number;
    positiveRate: number; acceptanceRate: number; previousReached: number; previousReplies: number;
  };
  allTime?: { leads: number; reached: number; accepted: number; replies: number; positive: number; acceptanceRate: number; replyRate: number; positiveRate: number };
  waiting?: number; campaignsRunning?: number; campaignsTotal?: number; sendersActive?: number;
  busiestSender?: { name: string; sent: number } | null;
  bestCampaigns?: { name: string; reached: number; accepted: number; replyRate: number }[];
  meetingsBooked?: number; meetingsUpcoming?: number;
  sparklines?: { reached: number[]; accepted: number[]; replies: number[]; positiveRate: number[] };
  feed?: FeedEvent[];
};

const n = (value: number) => value.toLocaleString("en-US");

const longDate = (iso: string | null | undefined) => {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
};

/** "2 days ago", "3 weeks ago" — the feed is read as ages, not timestamps. */
function ago(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at) || !now) return "";
  const days = Math.floor((now - at) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${days < 14 ? "" : "s"} ago`;
  if (days < 365) return `${Math.floor(days / 30)} month${days < 60 ? "" : "s"} ago`;
  return `${Math.floor(days / 365)} year${days < 730 ? "" : "s"} ago`;
}

/**
 * The briefing, written from the figures.
 *
 * Assembled in clauses rather than from one template, because a template that always says the same
 * thing in the same order reads as generated the second time somebody sees it. Each clause is included
 * only when it has something to say: no replies means the reply clause is absent rather than "0
 * replies", and an unscored month says the count is unscored instead of claiming a positive rate of
 * zero. The comparison against the previous month only appears once there is a previous month to
 * compare with.
 */
function briefing(data: Payload): React.ReactNode[] {
  const w = data.window;
  if (!w) return [];
  const parts: React.ReactNode[] = [];

  if (!w.reached && !w.replies) {
    return [
      <span key="quiet">
        Nothing has gone out in the last {w.days} days. Campaigns that are paused or finished show on the{" "}
        <b>Campaigns</b> tab with what they produced.
      </span>,
    ];
  }

  parts.push(
    <span key="reach">
      QC reached <b>{n(w.reached)}</b> new {w.reached === 1 ? "person" : "people"} for you
      {w.accepted > 0 ? <> and <b>{n(w.accepted)}</b> accepted the connection</> : null}.
    </span>,
  );

  if (w.replies > 0) {
    parts.push(
      <span key="replies">
        {" "}
        <b>{n(w.replies)}</b> {w.replies === 1 ? "person" : "people"} replied
        {w.scored > 0 ? (
          <>
            , and <span className="ov-quiet">of the {n(w.scored)} we have read closely,</span>{" "}
            <b>{n(w.positive)} were positive</b>
          </>
        ) : null}
        .
      </span>,
    );
  }

  // Only claim a direction once there is a previous month with something in it to compare against.
  if (w.previousReplies > 0 && w.replies > 0) {
    const change = Math.round(((w.replies - w.previousReplies) / w.previousReplies) * 100);
    if (Math.abs(change) >= 10) {
      parts.push(
        <span key="trend" className="ov-quiet">
          {" "}
          That is {Math.abs(change)}% {change > 0 ? "more" : "fewer"} replies than the {w.days} days before.
        </span>,
      );
    }
  }

  return parts;
}

const KIND_MARK: Record<FeedEvent["kind"], string> = { positive: "★", reply: "↩", launch: "▲", meeting: "◆" };

function Overview() {
  const params = useSearchParams();
  const clientSlug = params.get("client");

  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(0);

  useEffect(() => setNow(Date.now()), []);

  useEffect(() => {
    setData(null);
    void (async () => {
      try {
        const query = clientSlug ? `?client=${encodeURIComponent(clientSlug)}` : "";
        const response = await fetch(`/api/overview${query}`, { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as Payload;
        if (!response.ok) {
          setError(payload.error || "That did not load.");
          return;
        }
        setError("");
        setData(payload);
      } catch {
        setError("That did not load.");
      }
    })();
  }, [clientSlug]);

  if (error) return <div className="content"><p className="error-note">{error}</p></div>;
  if (!data) return <div className="content"><p className="loading">Loading…</p></div>;

  // ── Staff: the client directory ──────────────────────────────────────────────────────────────
  if (data.view === "directory") {
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
                <span className="client-logo" style={client.logoUrl ? undefined : { background: client.accentColor || "var(--accent)" }}>
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

  const client = data.client;
  const w = data.window;
  const all = data.allTime;
  if (!client || !w || !all) return <div className="content"><p className="empty">Nothing to show yet.</p></div>;

  const started = longDate(data.startedAt);
  const funnel = [
    { label: "Leads in campaigns", value: all.leads, tone: "k-untouched", note: null as string | null },
    { label: "Reached out to", value: all.reached, tone: "k-reached", note: all.leads ? `${Math.round((all.reached / all.leads) * 100)}% of leads` : null },
    { label: "Accepted", value: all.accepted, tone: "k-accepted", note: `${all.acceptanceRate}% acceptance` },
    { label: "Replied", value: all.replies, tone: "k-replied", note: `${all.replyRate}% of accepted` },
    { label: "Replied warmly", value: all.positive, tone: "k-positive", note: `${all.positiveRate}% of accepted` },
  ];
  const widest = Math.max(all.leads, 1);

  return (
    <div className="content ov-wide">
      <div className="client-head">
        <span className="client-logo" style={client.logoUrl ? undefined : { background: client.accentColor || "var(--accent)" }}>
          {client.logoUrl ? <img src={client.logoUrl} alt="" /> : (client.name[0] || "?").toUpperCase()}
        </span>
        <div>
          <h1>{client.name}</h1>
          <p>
            {started ? `Outbound running since ${started}` : "Your outbound programme"}
            {data.campaignsTotal ? ` · ${data.campaignsTotal} campaign${data.campaignsTotal === 1 ? "" : "s"}` : ""}
          </p>
        </div>
      </div>

      <section className="ov-brief">
        <span className="ov-brief-eyebrow">Last {w.days} days</span>
        <p>{briefing(data)}</p>
        <div className="ov-brief-foot">
          {data.bestCampaigns?.[0] && (
            <span>Best campaign <b>{data.bestCampaigns[0].name}</b> at {data.bestCampaigns[0].replyRate}% reply rate</span>
          )}
          {data.busiestSender && <span>Busiest sender <b>{data.busiestSender.name}</b>, {n(data.busiestSender.sent)} requests</span>}
          {(data.waiting ?? 0) > 0 && <span><b>{n(data.waiting ?? 0)}</b> conversations waiting on a reply</span>}
        </div>
      </section>

      <section className="ov-sparks">
        <Spark label="Reached" value={n(w.reached)} series={data.sparklines?.reached ?? []} tone="reached" />
        <Spark label="Accepted" value={n(w.accepted)} series={data.sparklines?.accepted ?? []} tone="accepted" note={`${w.acceptanceRate}% acceptance`} />
        <Spark label="Replies" value={n(w.replies)} series={data.sparklines?.replies ?? []} tone="replied" />
        <Spark
          label="Positive rate"
          value={w.scored ? `${w.positiveRate}%` : "—"}
          series={data.sparklines?.positiveRate ?? []}
          tone="positive"
          note={w.scored ? `of ${n(w.scored)} read closely` : "none read closely yet"}
        />
        <Spark label="Waiting on a reply" value={n(data.waiting ?? 0)} series={[]} tone="reached" note="they spoke last" />
      </section>

      <div className="ov-grid">
        <div className="ov-column">
          <section className="panel">
            <div className="panel-head">
              <h2>All time</h2>
              <span>{started ? `Since ${started}` : "Whole engagement"}</span>
            </div>
            <div className="ov-funnel">
              {funnel.map((step) => (
                <div className="ov-fstep" key={step.label}>
                  <span>{step.label}</span>
                  <span className={`ov-fbar ${step.tone}`} style={{ width: `${Math.max((step.value / widest) * 100, 6)}%` }}>
                    {n(step.value)}
                  </span>
                  <em>{step.note ?? "—"}</em>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Best performing campaigns</h2>
              <span>By reply rate</span>
            </div>
            {data.bestCampaigns?.length ? (
              <div className="ov-list">
                {data.bestCampaigns.map((campaign) => (
                  <div className="ov-lrow" key={campaign.name}>
                    <span>
                      <strong>{campaign.name}</strong>
                      <small>{n(campaign.reached)} reached · {n(campaign.accepted)} accepted</small>
                    </span>
                    <data>{campaign.replyRate}%</data>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty">No campaign has sent enough for a rate to mean much yet.</p>
            )}
          </section>

          <section className="ov-mini-row">
            <div className="panel ov-mini">
              <span>Meetings booked</span>
              <strong>{n(data.meetingsBooked ?? 0)}</strong>
              <em>{(data.meetingsUpcoming ?? 0) > 0 ? `${data.meetingsUpcoming} upcoming` : "none on the calendar"}</em>
            </div>
            <div className="panel ov-mini">
              <span>Campaigns running</span>
              <strong>{n(data.campaignsRunning ?? 0)}</strong>
              <em>{data.sendersActive ?? 0} sender{(data.sendersActive ?? 0) === 1 ? "" : "s"} active</em>
            </div>
          </section>
        </div>

        <section className="panel ov-feed-panel">
          <div className="panel-head">
            <h2>Recent activity</h2>
            <span>Newest first</span>
          </div>
          {data.feed?.length ? (
            <div className="ov-feed">
              {data.feed.map((event, index) => (
                <div className="ov-event" key={`${event.at}-${index}`}>
                  <span className={`ov-dot is-${event.kind}`} aria-hidden="true">{KIND_MARK[event.kind]}</span>
                  <span className="ov-event-words">
                    <strong>{event.title}</strong>
                    {event.detail && <small>{event.detail}</small>}
                  </span>
                  <time>{ago(event.at, now)}</time>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty">Nothing recorded yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}

/** A figure with the shape of the last month under it. An empty series just omits the shape. */
function Spark({ label, value, series, tone, note }: { label: string; value: string; series: number[]; tone: string; note?: string }) {
  const peak = Math.max(...series, 1);
  return (
    <div className="ov-spark">
      <span>{label}</span>
      <strong>{value}</strong>
      {series.length > 0 && (
        <div className={`ov-spark-bars is-${tone}`} aria-hidden="true">
          {series.map((point, index) => (
            <i key={index} style={{ height: `${Math.max((point / peak) * 100, 4)}%` }} />
          ))}
        </div>
      )}
      {note && <em>{note}</em>}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Overview />
    </Suspense>
  );
}
