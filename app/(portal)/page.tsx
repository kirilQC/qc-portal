// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";
/* eslint-disable react-hooks/set-state-in-effect -- loads on mount and when the client changes; the
   setState calls sit inside async callbacks rather than the effect body. */

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
// The funnel's colour tokens live with the campaigns page. Imported rather than copied, so a band means
// the same thing on both screens by construction.
import "./campaigns/campaigns.css";
import "./overview.css";
import ActivityNetwork, { type ActivityEvent } from "../components/ActivityNetwork";

/**
 * The client's overview: a month in a sentence, the trend behind it, and what has happened since.
 *
 * ── Why it opens with prose ─────────────────────────────────────────────────────────────────────
 * A client looks at this once a fortnight and wants to know how it is going. Five equal numbers make
 * them assemble that answer themselves, and the version this replaces led with "Meetings booked 0" and
 * "Attributed pipeline $0" — two zeros as the first impression of the work. A sentence says the same
 * thing faster and puts the empty figures where they belong: in a supporting row, stated honestly.
 *
 * ── Why the network is here too ─────────────────────────────────────────────────────────────────
 * The sentence answers "how is it going". Recent activity answers "what has happened since I last
 * looked", which is the other question somebody opens a familiar page for — and it is drawn as the
 * sign-in constellation made of the client's own outreach, so the two screens feel like one product.
 * The events behind it are real replies, launches and meetings; see ActivityNetwork for which half of
 * it is data and which half is atmosphere.
 */
type Client = { id: string; name: string; slug: string; logoUrl: string | null; accentColor: string | null };
type FeedEvent = ActivityEvent;
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
  range?: string;
  rangeLabel?: string;
  ranges?: { key: string; label: string }[];
  funnel?: { key: string; label: string; value: number; tone: string; rate: number | null; of: string | null }[];
  activeCampaigns?: {
    campaignId: string; name: string; launchedAt: string | null; senders: string[]; senderCount: number;
    totalLeads: number; leadsPending: number; connectionsSent: number; connectionsAccepted: number;
    replies: number; acceptanceRate: number; replyRate: number; progress: number;
  }[];
  leadsTotal?: number; repliesTotal?: number;
  feed?: FeedEvent[];
  senders?: string[];
};

const n = (value: number) => value.toLocaleString("en-US");

const longDate = (iso: string | null | undefined) => {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
};

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


function Overview() {
  const params = useSearchParams();
  const clientSlug = params.get("client");

  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  /*
   * A week by default. These are weekly-call clients, so the question on opening the page is "what has
   * happened since we last spoke" rather than "how is the quarter going".
   */
  const [range, setRange] = useState("week");


  useEffect(() => {
    setData(null);
    void (async () => {
      try {
        const search = new URLSearchParams({ range });
        if (clientSlug) search.set("client", clientSlug);
        const response = await fetch(`/api/overview?${search.toString()}`, { cache: "no-store" });
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
  }, [clientSlug, range]);

  if (error) return <div className="content"><p className="error-note">{error}</p></div>;
  if (!data) return <div className="content"><p className="loading">Loading…</p></div>;

  // ── Staff: the client directory ──────────────────────────────────────────────────────────────
  if (data.view === "directory") {
    const clients = data.clients ?? [];
    return (
      <div className="content">
        <div className="page-head">
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
  const funnel = data.funnel ?? [];
  // Every bar is a share of the first step, which is the only denominator that makes the shape read as
  // a funnel rather than as five unrelated bars.
  const widest = Math.max(funnel[0]?.value ?? 1, 1);
  const active = data.activeCampaigns ?? [];

  /** The tabs this page hands off to, with the one number that says whether it is worth opening. */
  const tiles = [
    { href: "/inbox", label: "Inbox", value: n(data.repliesTotal ?? 0), note: "replies received" },
    { href: "/database", label: "Lead database", value: n(data.leadsTotal ?? 0), note: "leads in campaigns" },
    { href: "/campaigns", label: "Campaigns", value: n(data.campaignsTotal ?? 0), note: `${n(data.campaignsRunning ?? 0)} running` },
    { href: "/meetings", label: "Meetings", value: n(data.meetingsBooked ?? 0), note: (data.meetingsUpcoming ?? 0) > 0 ? `${data.meetingsUpcoming} upcoming` : "none booked yet" },
    { href: "/analytics", label: "Analytics", value: "", note: "Rates over time" },
    { href: "/messaging", label: "Messaging", value: "", note: "What we are sending" },
    { href: "/calls", label: "Weekly calls", value: "", note: "What was decided" },
  ];

  return (
    <div className="content ov-wide">
      <div className="client-head">
        <span className="client-logo" style={client.logoUrl ? undefined : { background: client.accentColor || "var(--accent)" }}>
          {client.logoUrl ? <img src={client.logoUrl} alt="" /> : (client.name[0] || "?").toUpperCase()}
        </span>
        <div>
          <h1>{client.name}</h1>
        </div>

        {/* A week by default: these are weekly-call clients, and the question on opening this page is
            "what happened since we last spoke". */}
        <div className="ov-ranges">
          {(data.ranges ?? []).map((option) => (
            <button
              key={option.key}
              className={`ov-range ${data.range === option.key ? "is-on" : ""}`}
              onClick={() => setRange(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <section className="ov-brief">
        <span className="ov-brief-eyebrow">{data.rangeLabel ?? "This week"}</span>
        <p>{briefing(data)}</p>
      </section>

      {/* The way on to everything else, directly under the summary — the first thing after "how is it
          going" is "take me to it". */}
      <section className="ov-tiles">
        {tiles.map((tile) => (
          <Link key={tile.href} href={`${tile.href}${clientSlug ? `?client=${encodeURIComponent(clientSlug)}` : ""}`} className="ov-tile">
            <span className="ov-tile-label">{tile.label}</span>
            {tile.value && <strong>{tile.value}</strong>}
            <em>{tile.note}</em>
            <span className="ov-tile-go">→</span>
          </Link>
        ))}
      </section>

      {/*
        * Three figures on one line, where five cards and two more cards used to be.
        *
        * The cards repeated numbers the sentence above them had just given, and "meetings booked" and
        * "campaigns running" had a bordered card each for a single digit.
        */}
      <section className="ov-strip">
        <div>
          <span>Acceptance</span>
          <strong>{w.reached ? `${w.acceptanceRate}%` : "—"}</strong>
          <em>{n(w.accepted)} of {n(w.reached)}</em>
        </div>
        <div>
          <span>Campaigns running</span>
          <strong>{n(data.campaignsRunning ?? 0)}</strong>
          <em>{data.sendersActive ?? 0} sender{(data.sendersActive ?? 0) === 1 ? "" : "s"} active</em>
        </div>
        <div>
          <span>Meetings booked</span>
          <strong>{n(data.meetingsBooked ?? 0)}</strong>
          <em>{(data.meetingsUpcoming ?? 0) > 0 ? `${data.meetingsUpcoming} upcoming` : "none on the calendar"}</em>
        </div>
      </section>

      <div className="ov-grid">
        <div className="ov-column">
          <section className="panel">
            <div className="panel-head">
              <h2>{data.rangeLabel ?? "This week"}</h2>
              <span>{data.range === "all" && started ? `Since ${started}` : ""}</span>
            </div>
            <div className="ov-funnel">
              {funnel.map((step) => (
                <div className="ov-fstep" key={step.key}>
                  <span className="ov-fname">{step.label}</span>
                  {/*
                    * The figure sits outside the bar. It used to be printed inside one that was
                    * `overflow: hidden` and as narrow as 6% of the row, so 178 rendered as "17" and
                    * nothing about it looked wrong — it looked like a number.
                    */}
                  <span className="ov-ftrack">
                    <i className={step.tone} style={{ width: `${Math.max((step.value / widest) * 100, 1)}%` }} />
                  </span>
                  <b className="ov-fval">{n(step.value)}</b>
                  <em className="ov-frate">{step.rate === null ? "" : `${step.rate}% ${step.of ?? ""}`}</em>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Active campaigns</h2>
              <span>{active.length ? `${active.length} running` : ""}</span>
            </div>
            {active.length ? (
              <div className="ov-list">
                {active.map((campaign) => (
                  <div className="ov-arow" key={campaign.campaignId}>
                    <div className="ov-atop">
                      <strong>{campaign.name}</strong>
                      <data>{campaign.acceptanceRate}%<small>acceptance</small></data>
                    </div>
                    <div className="ov-aprog" title={`${campaign.progress}% of the list worked`}>
                      <i style={{ width: `${campaign.progress}%` }} />
                    </div>
                    <div className="ov-afoot">
                      <span>{n(campaign.connectionsSent)} of {n(campaign.totalLeads)} worked</span>
                      {campaign.leadsPending > 0 && <span>{n(campaign.leadsPending)} left</span>}
                      <span>{campaign.senders.length ? campaign.senders.join(", ") : `${campaign.senderCount} sender${campaign.senderCount === 1 ? "" : "s"}`}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty">No campaign is running right now.</p>
            )}
          </section>

        </div>

        <ActivityNetwork
          events={data.feed ?? []}
          senders={data.senders ?? []}
          clientSlug={clientSlug}
        />
      </div>

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
