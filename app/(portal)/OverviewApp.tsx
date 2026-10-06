// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useClientSlug } from "../components/useClientSlug";
import { useCachedJson } from "../components/cache";
import { PageSkeleton } from "../components/PageSkeleton";
// The funnel's colour tokens live with the campaigns page. Imported rather than copied, so a band means
// the same thing on both screens by construction.
import "./[client]/campaigns/campaigns.css";
import "./overview.css";
import ActivityNetwork, { type ActivityEvent } from "../components/ActivityNetwork";
import ActivityChart, { type ActivityPoint } from "./ActivityChart";
import DateRangePicker, { type DayRange } from "./DateRangePicker";
import ReplyCalendar, { type CalendarData } from "./ReplyCalendar";
import CallRecap from "./CallRecap";

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
    positiveRate: number; acceptanceRate: number; replyRate: number; previousReached: number; previousReplies: number; previousAccepted?: number;
    /** All time only: the reply rate's own numerator and denominator (replies over leads messaged). */
    replyPart?: number; replyOf?: number;
  };
  allTime?: { leads: number; reached: number; accepted: number; replies: number; positive: number; acceptanceRate: number; replyRate: number; positiveRate: number };
  waiting?: number; campaignsRunning?: number; campaignsTotal?: number; sendersActive?: number;
  busiestSender?: { name: string; sent: number } | null;
  bestCampaigns?: { name: string; reached: number; accepted: number; replyRate: number }[];
  meetingsBooked?: number; meetingsUpcoming?: number;
  /** The automatic count, whether staff have overridden it, and whether this viewer may. */
  meetingsBookedAuto?: number; meetingsOverridden?: boolean; canEditMeetings?: boolean;
  range?: string;
  rangeLabel?: string;
  ranges?: { key: string; label: string }[];
  funnel?: { key: string; label: string; value: number; tone: string; rate: number | null; of: string | null }[];
  activeCampaigns?: {
    campaignId: string; name: string; launchedAt: string | null; senders: string[]; senderCount: number;
    totalLeads: number; leadsPending: number; connectionsSent: number; connectionsAccepted: number;
    replies: number; acceptanceRate: number; replyRate: number; progress: number;
    /** Senders on this campaign with sends logged today (a sender's whole day, across campaigns). */
    sendingToday?: { name: string; sent: number; cap: number }[];
    /** Days of sending left at the senders' daily cap; null when it can't be worked out (no senders). */
    daysLeft?: number | null;
  }[];
  leadsTotal?: number; reachedTotal?: number; repliesTotal?: number;
  activity?: { smoothed: boolean; points: ActivityPoint[] };
  /** Per-bucket series across the chosen window, for the stat grid's sparklines. */
  sparklines?: { reached: number[]; accepted: number[]; replies: number[]; positiveRate: number[] };
  calendar?: CalendarData;
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
        Nothing has gone out {data.range === "custom" ? "in this period" : w.days ? `in the last ${w.days} days` : "yet"}. Campaigns that are paused or finished show on the{" "}
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
        {w.positive > 0 ? <>, <b>{n(w.positive)}</b> of which were positive</> : null}
        .
      </span>,
    );
  }

  // Only ever good news: the comparison sentence appears solely when replies went UP. A "20% fewer" line
  // is technically true but reads as a scolding on the client's own dashboard, so it is simply omitted.
  if (w.previousReplies > 0 && w.replies > 0) {
    const change = Math.round(((w.replies - w.previousReplies) / w.previousReplies) * 100);
    if (change >= 10) {
      parts.push(
        <span key="trend" className="ov-quiet">
          {" "}
          That is {change}% more replies than the {w.days} days before.
        </span>,
      );
    }
  }

  return parts;
}


function Overview() {
  const clientSlug = useClientSlug();

  /*
   * A week by default. These are weekly-call clients, so the question on opening the page is "what has
   * happened since we last spoke" rather than "how is the quarter going".
   */
  const [range, setRange] = useState("week");
  const [custom, setCustom] = useState<DayRange | null>(null);

  // Served from the shared cache: revisiting the overview shows the last figures instantly and refreshes
  // them in the background, so switching to this tab and back never flashes a loading state again.
  const search = new URLSearchParams({ range });
  if (range === "custom" && custom) { search.set("from", custom.from); search.set("to", custom.to); }
  if (clientSlug) search.set("client", clientSlug);
  const { data, error, reload } = useCachedJson<Payload>(`/api/overview?${search.toString()}`);
  // Keep the page live while it is open: a quiet refresh every two minutes, only while the tab is visible.
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") reload(); }, 120_000);
    return () => clearInterval(timer);
  }, [reload]);

  if (error && !data) return <div className="content"><p className="error-note">{error}</p></div>;
  if (!data) return <PageSkeleton tiles={8} />;

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
              <Link key={client.id} href={`/${client.slug}`} className="tile">
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
  // The actual calendar span the window covers, e.g. "8/26 – 9/2", so "This week" says which week.
  const rangeSpan = (() => {
    const days = data.window?.days;
    // A custom range already names its own dates in the label.
    if (!days || data.range === "custom") return "";
    const end = new Date();
    const start = new Date(end.getTime() - days * 86_400_000);
    const f = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
    return `${f(start)} – ${f(end)}`;
  })();
  const funnel = data.funnel ?? [];
  // Every bar is a share of the first step, which is the only denominator that makes the shape read as
  // a funnel rather than as five unrelated bars.
  const widest = Math.max(funnel[0]?.value ?? 1, 1);
  const active = data.activeCampaigns ?? [];

  /** The tabs this page hands off to, with the one number that says whether it is worth opening. */
  // Eight figures on one flush grid — four counts up top, four rates/outcomes below. `href` makes a cell
  // link into its tab; `math` shows the tiny "n of m" under a rate.
  // What the badges and sparklines measure against. "All time" has no window to compare, so it has none.
  const windowed = data.range !== "all";
  const rangeWord = data.range === "week" ? "this week" : data.range === "month" ? "this month" : "in range";
  const spark = data.sparklines;
  /** A rate's change against the window before, in percentage points: "▲ 3.1 pts", or nothing to compare. */
  const ptsChange = (now: number, part: number, of: number): Chip | undefined => {
    if (!windowed || !w.reached || of <= 0) return undefined;
    const before = Math.round((part / of) * 1000) / 10;
    const diff = Math.round((now - before) * 10) / 10;
    if (Math.abs(diff) < 0.1) return { text: "no change", tone: "flat" };
    return { text: `${diff > 0 ? "▲" : "▼"} ${Math.abs(diff)} pts`, tone: diff > 0 ? "up" : "down", title: `${before}% the ${w.days} days before` };
  };
  const added = (value: number): Chip | undefined => (windowed && value > 0 ? { text: `+${n(value)} ${rangeWord}`, tone: "up" } : undefined);
  const meetingSeries = (data.activity?.points ?? []).map((point) => point.meetings);
  const cells: { label: string; value: string; href?: string; math?: string; spark?: number[]; color?: string; chip?: Chip }[] = [
    { label: "Reached out to", value: n(data.reachedTotal ?? 0), href: "/campaigns", spark: windowed ? spark?.reached : undefined, color: "#8b93b8", chip: added(w.reached) },
    // The lead database: everyone who has engaged. Named for what it is, so it isn't read as the number
    // of prospects (that is "Reached out to") or compared with Replies as if they should match.
    { label: "Lead database", value: n(data.leadsTotal ?? 0), href: "/database", math: "People who engaged" },
    { label: "Replies", value: n(data.repliesTotal ?? 0), href: "/inbox", spark: windowed ? spark?.replies : undefined, color: "#3fb0a6", chip: added(w.replies) },
    { label: "Campaigns", value: n(data.campaignsTotal ?? 0), href: "/campaigns" },
    { label: "Acceptance rate", value: w.reached ? `${w.acceptanceRate}%` : "—", math: w.reached ? `${n(w.accepted)} of ${n(w.reached)}` : undefined, spark: windowed ? spark?.accepted : undefined, color: "#7c6cf0", chip: ptsChange(w.acceptanceRate, w.previousAccepted ?? 0, w.previousReached) },
    { label: "Reply rate", value: w.reached ? `${w.replyRate}%` : "—", math: w.reached ? (w.replyOf != null ? `${n(w.replyPart ?? 0)} campaign replies of ${n(w.replyOf)} messaged` : `${n(w.replies)} of ${n(w.reached)}`) : undefined, spark: windowed ? spark?.replies : undefined, color: "#3fb0a6", chip: ptsChange(w.replyRate, w.previousReplies, w.previousReached) },
    { label: "Campaigns running", value: n(data.campaignsRunning ?? 0), href: "/campaigns", chip: (data.campaignsRunning ?? 0) > 0 ? { text: "live", tone: "live" } : undefined },
    {
      label: "Meetings booked", value: n(data.meetingsBooked ?? 0), href: "/meetings",
      spark: windowed && meetingSeries.some(Boolean) ? meetingSeries : undefined, color: "#c9b8ff",
      chip: (data.meetingsUpcoming ?? 0) > 0 ? { text: `${n(data.meetingsUpcoming ?? 0)} coming up`, tone: "meet" } : undefined,
    },
  ];

  return (
    <div className="content ov-wide">
      {/* The live activity network is the hero — a wide animated banner with the week's summary over it. */}
      <ActivityNetwork
        variant="hero"
        events={data.feed ?? []}
        senders={data.senders ?? []}
        clientSlug={clientSlug}
        header={
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
            <DateRangePicker value={custom} active={data.range === "custom"} onApply={(next) => { setCustom(next); setRange("custom"); }} />
          </div>
        </div>
        }
      >
        <span className="ov-brief-eyebrow">{data.rangeLabel ?? "This week"}</span>
        <p>{briefing(data)}</p>
      </ActivityNetwork>

      {/* Eight figures, one flush grid — four across, two rows. Cells with an href link into their tab. */}
      <section className="ov-stats">
        {cells.map((cell) => {
          if (cell.label === "Meetings booked" && data.canEditMeetings) {
            return (
              <MeetingsCell
                key={cell.label}
                spark={cell.spark}
                chip={cell.chip}
                value={data.meetingsBooked ?? 0}
                auto={data.meetingsBookedAuto ?? data.meetingsBooked ?? 0}
                overridden={Boolean(data.meetingsOverridden)}
                clientSlug={clientSlug}
                onSaved={reload}
              />
            );
          }
          const inner = (
            <>
              {cell.spark && <Sparkline values={cell.spark} color={cell.color ?? "var(--accent)"} />}
              <span className="ov-cell-top"><strong>{cell.value}</strong>{cell.chip && <ChipBadge chip={cell.chip} />}</span>
              <span className="ov-cell-label">{cell.label}</span>
              {cell.math && <em>{cell.math}</em>}
            </>
          );
          return cell.href ? (
            <Link key={cell.label} href={`${clientSlug ? `/${clientSlug}` : ""}${cell.href}`} className="ov-cell">
              {inner}
            </Link>
          ) : (
            <div key={cell.label} className="ov-cell">
              {inner}
            </div>
          );
        })}
      </section>

      <section className="panel ov-thisweek">
            <div className="panel-head">
              <h2>{data.rangeLabel ?? "This week"}{rangeSpan ? ` (${rangeSpan})` : ""}</h2>
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
                </div>
              ))}
            </div>
      </section>

      <section className="panel ov-trend">
        <div className="panel-head">
          <h2>Activity</h2>
          <span>{data.range === "all" ? "Since the engagement started" : data.range === "custom" ? data.rangeLabel : data.range === "month" ? "Last 30 days" : "Last 7 days"}</span>
        </div>
        <ActivityChart key={`${data.range}-${custom?.from ?? ""}-${custom?.to ?? ""}`} points={data.activity?.points ?? []} smoothed={Boolean(data.activity?.smoothed)} />
      </section>

      {/* The month's replies as a heat map, beside what was agreed on the last weekly call. */}
      <div className="ov-split">
        {data.calendar && <ReplyCalendar data={data.calendar} />}
        <CallRecap clientSlug={clientSlug} />
      </div>

      <section className="panel ov-campaigns">
            <div className="panel-head">
              <h2>Active campaigns</h2>
            </div>
            {active.length ? (
              <>
                <div className="cmp-legend ov-legend">
                  <span><i className="k-untouched" />Not contacted</span>
                  <span><i className="k-reached" />Reached</span>
                  <span><i className="k-accepted" />Accepted</span>
                  <span><i className="k-replied" />Replied</span>
                </div>
                <div className="ov-list">
                  {active.map((campaign) => {
                    const untouched = Math.max(0, campaign.leadsPending);
                    const reachable = Math.max(campaign.connectionsSent + untouched, 1);
                    const replied = Math.max(0, campaign.replies);
                    const acceptedOnly = Math.max(0, campaign.connectionsAccepted - replied);
                    const reachedOnly = Math.max(0, campaign.connectionsSent - campaign.connectionsAccepted);
                    const share = (value: number) => (value / reachable) * 100;
                    return (
                      <div className="ov-arow" key={campaign.campaignId}>
                        <div className="ov-atop">
                          <strong>{campaign.name}</strong>
                          <span className="ov-aright">
                            {(campaign.sendingToday ?? []).map((sender) => (
                              <span key={sender.name} className="ov-sending" title={sender.cap ? `${n(sender.sent)} of ${n(sender.cap)} today, across every campaign this sender works` : undefined}>
                                <i aria-hidden="true" />{sender.name.split(" ")[0]} sending · {n(sender.sent)} today
                              </span>
                            ))}
                            <data>{campaign.acceptanceRate}%<small>acceptance</small></data>
                          </span>
                        </div>
                        <div className="ov-cwrap">
                        <div className="cmp-funnel ov-cfunnel ov-cgrow" role="img" aria-label={`${untouched} not contacted, ${n(campaign.connectionsSent)} reached, ${n(campaign.connectionsAccepted)} accepted, ${replied} replied`}>
                          {untouched > 0 && <span className="k-untouched" style={{ width: `${share(untouched)}%` }} title={`${n(untouched)} not contacted yet`} />}
                          {reachedOnly > 0 && <span className="k-reached" style={{ width: `${share(reachedOnly)}%` }} title={`${n(reachedOnly)} reached, not accepted`} />}
                          {acceptedOnly > 0 && <span className="k-accepted" style={{ width: `${share(acceptedOnly)}%` }} title={`${n(acceptedOnly)} accepted, no reply`} />}
                          {replied > 0 && <span className="k-replied" style={{ width: `${share(replied)}%` }} title={`${n(replied)} replied`} />}
                        </div>
                        {/* The work front: where the list stops being untouched. It glows while someone is sending today. */}
                        {untouched > 0 && (
                          <span className={`ov-front ${(campaign.sendingToday ?? []).length ? "is-live" : ""}`} style={{ left: `${share(untouched)}%` }} aria-hidden="true" />
                        )}
                        </div>
                        <div className="ov-afoot">
                          <span>{n(campaign.connectionsSent)} of {n(campaign.totalLeads)} worked</span>
                          {campaign.leadsPending > 0 && <span>{n(campaign.leadsPending)} left</span>}
                          {campaign.daysLeft != null && campaign.daysLeft > 0 && (
                            <span className="ov-daysleft">{campaign.daysLeft === 1 ? "1 day" : `${n(campaign.daysLeft)} days`} of sending left</span>
                          )}
                          <span>{campaign.senders.length ? campaign.senders.join(", ") : `${campaign.senderCount} sender${campaign.senderCount === 1 ? "" : "s"}`}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="empty">No campaign is running right now.</p>
            )}
      </section>

    </div>
  );
}

export default function Page() {
  return (
      <Overview />
  );
}

/**
 * The "Meetings booked" tile as staff see it: the same figure, plus a way to set it by hand.
 *
 * The automatic count only knows meetings that reached QC Command, so staff can override it for a client
 * (a call booked over email, one the client set up off our intro). Clients see only the number — never
 * whether it was set by hand. "Use count" deletes the override and hands the tile back to the count.
 */
function MeetingsCell({ value, auto, overridden, clientSlug, onSaved, spark, chip }: {
  value: number; auto: number; overridden: boolean; clientSlug: string | null; onSaved: () => void;
  spark?: number[]; chip?: Chip;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // Focus the field when it opens, so a number can be typed straight away.
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const save = async (meetingsBooked: number | null) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/meetings-override", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client: clientSlug, meetingsBooked }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "That did not save.");
      setEditing(false);
      onSaved();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <div className="ov-cell ov-cell-staff">
        {spark && <Sparkline values={spark} color="#c9b8ff" />}
        <span className="ov-cell-top"><strong>{n(value)}</strong>{chip && <ChipBadge chip={chip} />}</span>
        <span className="ov-cell-label">Meetings booked</span>
        <em>
          {overridden ? `Set by QC · counted ${n(auto)}` : "Counted automatically"}
          {" · "}
          <button type="button" className="ov-cell-edit" onClick={() => { setDraft(String(value)); setEditing(true); }}>
            Edit
          </button>
        </em>
      </div>
    );
  }

  const parsed = Number(draft);
  const valid = draft.trim() !== "" && Number.isInteger(parsed) && parsed >= 0;
  return (
    <form
      className="ov-cell ov-cell-staff ov-cell-editing"
      onSubmit={(event) => { event.preventDefault(); if (valid && !busy) void save(parsed); }}
    >
      <input
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Escape") setEditing(false); }}
        aria-label="Meetings booked"
        ref={inputRef}
      />
      <span className="ov-cell-actions">
        <button type="submit" disabled={!valid || busy}>{busy ? "Saving…" : "Save"}</button>
        {overridden && (
          <button type="button" disabled={busy} onClick={() => void save(null)}>Use count ({n(auto)})</button>
        )}
        <button type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
      </span>
      {error && <em className="ov-cell-error">{error}</em>}
    </form>
  );
}

type Chip = { text: string; tone: "up" | "down" | "flat" | "live" | "meet"; title?: string };

function ChipBadge({ chip }: { chip: Chip }) {
  return (
    <span className={`ov-chip ov-chip-${chip.tone}`} title={chip.title}>
      {chip.tone === "live" && <i aria-hidden="true" />}
      {chip.text}
    </span>
  );
}

/**
 * A stat cell's sparkline: the window's series, drawn in behind the figure, ending on a pulsing dot.
 * Decorative — the figure and its badge carry the meaning — so it is hidden from screen readers.
 */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const W = 220, H = 56, top = 8, bottom = 52;
  const max = Math.max(...values), min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values.map((v, i) => [4 + (i / (values.length - 1)) * (W - 10), bottom - ((v - min) / span) * (bottom - top)] as const);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i - 1][0] + pts[i][0]) / 2;
    d += ` C${mx},${pts[i - 1][1]} ${mx},${pts[i][1]} ${pts[i][0]},${pts[i][1]}`;
  }
  const end = pts[pts.length - 1];
  return (
    <svg className="ov-spark" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" style={{ color }}>
      <path className="ov-spark-area" d={`${d} L${end[0]},${H} L${pts[0][0]},${H} Z`} />
      <path className="ov-spark-line" d={d} pathLength={1} />
      <circle className="ov-spark-end" cx={end[0]} cy={end[1]} r={3} />
    </svg>
  );
}
