// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";
/* eslint-disable react-hooks/set-state-in-effect -- the load happens on mount and on client change;
   the setState calls sit inside async callbacks rather than the effect body. */

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useClientSlug } from "../../components/useClientSlug";
import { activeTimeZone } from "../../components/Appearance";
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

/** Where the pane divider was left. */
const SPLIT_KEY = "qc-portal:inbox-split";
/** Which leads have been starred. Per browser, as Reply Radar keeps them in its layout preferences. */
const STARS_KEY = "qc-portal:inbox-stars";

type Sort = "recent" | "oldest" | "score-desc" | "name";
const SORTS: [Sort, string][] = [
  ["recent", "Newest reply"],
  ["oldest", "Oldest reply"],
  ["score-desc", "Highest lead score"],
  ["name", "Name A–Z"],
];
const TIERS = ["hot", "warm", "nurture"];

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

/**
 * Dates rendered in the reader's chosen zone rather than their machine's.
 *
 * A reply that landed at 9:38pm Eastern should say so to everyone looking at it, or two people
 * discussing the same conversation are three hours apart on when it happened.
 */
function dateParts(iso: string | null, timeZone: string): { date: string; time: string } {
  if (!iso) return { date: "—", time: "" };
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return { date: "—", time: "" };
  try {
    return {
      date: value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone }),
      time: value.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone }),
    };
  } catch {
    // An unknown zone should not blank the column.
    return {
      date: value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      time: value.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
    };
  }
}

function Avatar({ src, alt, fallback }: { src?: string | null; alt: string; fallback: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <>{fallback}</>;
  return <img src={src} alt={alt} onError={() => setFailed(true)} />;
}

function Inbox() {
  const clientSlug = useClientSlug();

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
  const [searchOpen, setSearchOpen] = useState(false);
  const [sort, setSort] = useState<Sort>("recent");
  const [tierFilter, setTierFilter] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);
  const [stars, setStars] = useState<string[]>([]);
  const [submenu, setSubmenu] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STARS_KEY);
      if (raw) setStars(JSON.parse(raw) as string[]);
    } catch {
      /* no stars is a fine starting point */
    }
  }, []);

  const toggleStar = (leadId: string) => {
    setStars((was) => {
      const next = was.includes(leadId) ? was.filter((id) => id !== leadId) : [...was, leadId];
      try {
        window.localStorage.setItem(STARS_KEY, JSON.stringify(next));
      } catch {
        /* the star is a convenience */
      }
      return next;
    });
  };
  const searchInput = useRef<HTMLInputElement | null>(null);
  const [timeZone, setTimeZone] = useState("America/New_York");
  useEffect(() => setTimeZone(activeTimeZone()), []);

  /**
   * Where the queue ends and the conversation begins, as a percentage, dragged by the divider.
   *
   * Remembered per browser because it is a working preference, not a setting: somebody triaging a long
   * queue wants the table wide, and somebody reading one thread wants the pane wide, and they are the
   * same person twenty minutes apart. Clamped so neither side can be dragged to nothing.
   */
  const [split, setSplit] = useState(62);
  const dragging = useRef(false);
  const grid = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(SPLIT_KEY));
      if (Number.isFinite(saved) && saved >= 35 && saved <= 80) setSplit(saved);
    } catch {
      /* the default split is fine */
    }
  }, []);

  useEffect(() => {
    const move = (event: MouseEvent) => {
      if (!dragging.current || !grid.current) return;
      const box = grid.current.getBoundingClientRect();
      const next = Math.min(80, Math.max(35, ((event.clientX - box.left) / box.width) * 100));
      setSplit(next);
    };
    const stop = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.classList.remove("is-dragging");
      try {
        window.localStorage.setItem(SPLIT_KEY, String(Math.round(split)));
      } catch {
        /* the preference is a convenience */
      }
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", stop);
    return () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", stop);
    };
  }, [split]);
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
        if (tierFilter && lead.tier !== tierFilter) return false;
        if (starredOnly && !stars.includes(lead.leadId)) return false;

        const when = Date.parse(lead.latestReplyAt || lead.lastMessageAt);
        if (filter === "today") return when >= todayStart;
        if (filter === "week") return when >= weekStart;
        if (filter === "follow-ups") return lead.score > 0;
        return true;
      })
      .sort((a, b) => {
        if (filter === "follow-ups") return b.score - a.score;
        if (sort === "oldest") return Date.parse(a.latestReplyAt || a.lastMessageAt) - Date.parse(b.latestReplyAt || b.lastMessageAt);
        if (sort === "score-desc") return (b.leadScore ?? -1) - (a.leadScore ?? -1);
        if (sort === "name") return a.name.localeCompare(b.name);
        return Date.parse(b.latestReplyAt || b.lastMessageAt) - Date.parse(a.latestReplyAt || a.lastMessageAt);
      });
  }, [leads, search, filter, campaignFilter, senderFilter, sentimentFilter, tierFilter, starredOnly, stars, sort]);

  const current = filtered.find((lead) => lead.id === selectedId) ?? filtered[0] ?? null;

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: "end" });
  }, [current?.id]);

  // Focus follows the open state rather than an autoFocus prop, which steals focus on mount.
  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);

  // The five metrics, computed from what is on screen, exactly as Reply Radar computes them.
  const totalReplies = filtered.reduce((sum, lead) => sum + lead.replies, 0);
  const needsReply = filtered.filter((lead) => lead.messages.at(-1)?.direction === "inbound").length;
  const positive = filtered.filter((lead) => lead.sentiment === "positive").length;
  const scored = filtered.filter((lead) => lead.sentiment).length;
  const positiveRate = scored ? ((positive / scored) * 100).toFixed(1) : "0.0";
  const rangeWord = filter === "today" ? "today" : filter === "week" ? "this week" : filter === "follow-ups" ? "needing follow-up" : "all time";

  const options = (pick: (lead: Lead) => string | null) =>
    [...new Set(leads.map(pick).filter((value): value is string => Boolean(value)))].sort();

  if (!clientSlug && error) {
    return <div className="content"><p className="empty">Pick a client from the directory first.</p></div>;
  }

  return (
    <div className="inbox-wrap">
      {error && <p className="error-note" style={{ margin: "20px 32px 0" }}>{error}</p>}

      <div className="inbox-metrics">
        <Metric label={`Replies ${rangeWord}`} value={String(totalReplies)} tone="purple" />
        <Metric label={`Number of leads needing reply ${rangeWord}`} value={String(needsReply)} tone="coral" />
        <Metric label="Conversations" value={String(filtered.length)} tone="amber" />
        <Metric label="Positive replies" value={String(positive)} tone="green" />
        <Metric label={`Positive reply rate ${rangeWord}`} value={`${positiveRate}%`} tone="green" />
      </div>

      <div className="inbox-bar">
        <h2 className="inbox-title">Reply queue <b>{filtered.length}</b></h2>
        <div className="inbox-controls">
          <div className={`inbox-search ${searchOpen || search ? "is-open" : ""}`}>
            <button
              className="inbox-search-toggle"
              onClick={() => setSearchOpen((was) => !was)}
              aria-label="Search"
              title="Search"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
              </svg>
            </button>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, company, campaign"
              onBlur={() => { if (!search) setSearchOpen(false); }}
              ref={searchInput}
            />
          </div>
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
              <div className="filter-dropdown" onMouseLeave={() => setSubmenu(null)}>
                <button
                  className={`uf-item ${starredOnly ? "uf-active" : ""}`}
                  onMouseEnter={() => setSubmenu(null)}
                  onClick={() => setStarredOnly((was) => !was)}
                >
                  Starred {starredOnly ? "✓" : ""}
                </button>

                <FilterRow label="Campaign" value={campaignFilter} onOpen={() => setSubmenu("campaign")} />
                <FilterRow label="Sender" value={senderFilter} onOpen={() => setSubmenu("sender")} />
                <FilterRow label="Sentiment" value={sentimentFilter} onOpen={() => setSubmenu("sentiment")} />
                <FilterRow label="Tier" value={tierFilter} onOpen={() => setSubmenu("tier")} />
                <FilterRow label="Sort" value={sort === "recent" ? "" : (SORTS.find(([key]) => key === sort)?.[1] ?? "")} onOpen={() => setSubmenu("sort")} />

                <div className="uf-divider" />
                <button
                  className="uf-item uf-clear"
                  onClick={() => {
                    setCampaignFilter(""); setSenderFilter(""); setSentimentFilter("");
                    setTierFilter(""); setStarredOnly(false); setSort("recent");
                    setSubmenu(null); setFiltersOpen(false);
                  }}
                >
                  Clear all filters
                </button>

                {submenu === "campaign" && <Submenu current={campaignFilter} values={options((l) => l.campaignName)} onPick={setCampaignFilter} allLabel="All campaigns" />}
                {submenu === "sender" && <Submenu current={senderFilter} values={options((l) => l.senderName)} onPick={setSenderFilter} allLabel="All senders" />}
                {submenu === "sentiment" && <Submenu current={sentimentFilter} values={["positive", "neutral", "negative"]} onPick={setSentimentFilter} allLabel="Any sentiment" />}
                {submenu === "tier" && <Submenu current={tierFilter} values={TIERS} onPick={setTierFilter} allLabel="Any tier" />}
                {submenu === "sort" && (
                  <div className="uf-sub">
                    {SORTS.map(([key, label]) => (
                      <button key={key} className={`uf-sub-item ${sort === key ? "uf-active" : ""}`} onClick={() => setSort(key)}>
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="inbox-grid" ref={grid} style={{ gridTemplateColumns: `minmax(0, ${split}fr) 10px minmax(300px, ${100 - split}fr)` }}>
        <div className="queue-card">
          <div className="queue-scroll">
          <div className="table-head">
            <span>LEAD</span>
            <span className="mid">CAMPAIGN</span>
            <span className="mid">LATEST REPLY</span>
            <span className="mid">SENDER</span>
            <span className="mid">REPLIES</span>
            <span className="mid">LEAD SCORE</span>
          </div>
          {!loaded ? (
            <p className="loading">Loading conversations…</p>
          ) : filtered.length === 0 ? (
            <p className="empty">No conversations match.</p>
          ) : (
            <>
              {filtered.slice(0, visible).map((lead) => {
                const when = dateParts(lead.latestReplyAt, timeZone);
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
                          <span
                            className={`lead-star ${stars.includes(lead.leadId) ? "is-starred" : ""}`}
                            role="button"
                            tabIndex={0}
                            title={stars.includes(lead.leadId) ? "Unstar" : "Star"}
                            onClick={(event) => { event.stopPropagation(); toggleStar(lead.leadId); }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); toggleStar(lead.leadId); }
                            }}
                          >
                            ★
                          </span>
                        </strong>
                        <span>{[lead.role, lead.company].filter(Boolean).join(" @ ") || "No title or company"}</span>
                      </div>
                    </div>
                    <div className="cell mid"><strong>{lead.campaignName || "No campaign"}</strong></div>
                    <div className="cell mid"><strong>{when.date}</strong><span>{when.time}</span></div>
                    <div className="cell mid"><strong>{lead.senderName}</strong></div>
                    <div className="cell mid"><strong>{lead.replies}</strong></div>
                    <div className="cell mid"><strong>{lead.leadScore ?? "—"}</strong></div>
                  </div>
                );
              })}
              {filtered.length > visible && (
                <button className="see-more" onClick={() => setVisible((count) => count + 10)}>
                  Show 10 more leads
                </button>
              )}
            </>
          )}
          </div>
        </div>

        {/* The divider. A button so it is reachable from the keyboard, where the arrows nudge it. */}
        <button
          className="pane-divider"
          aria-label="Resize the panes"
          onMouseDown={() => { dragging.current = true; document.body.classList.add("is-dragging"); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") setSplit((was) => Math.max(35, was - 2));
            if (event.key === "ArrowRight") setSplit((was) => Math.min(80, was + 2));
          }}
        />

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
                        <time>{dateParts(message.sentAt, timeZone).date} · {dateParts(message.sentAt, timeZone).time}</time>
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
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${tone}`} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/** One row of the Filters menu: a label, what it is currently set to, and a chevron into its submenu. */
function FilterRow({ label, value, onOpen }: { label: string; value: string; onOpen: () => void }) {
  return (
    <button className="uf-item" onMouseEnter={onOpen} onClick={onOpen}>
      <span>{label}{value ? ` · ${value.slice(0, 18)}` : ""}</span>
      <b>›</b>
    </button>
  );
}

/** The panel a Filters row opens, listing every value plus a way back to all of them. */
function Submenu({ current, values, onPick, allLabel }: { current: string; values: string[]; onPick: (next: string) => void; allLabel: string }) {
  return (
    <div className="uf-sub">
      <button className={`uf-sub-item ${!current ? "uf-active" : ""}`} onClick={() => onPick("")}>{allLabel}</button>
      {values.slice(0, 60).map((option) => (
        <button key={option} className={`uf-sub-item ${current === option ? "uf-active" : ""}`} onClick={() => onPick(option)}>
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
