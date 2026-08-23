// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";
/* eslint-disable react-hooks/set-state-in-effect -- loads on mount and whenever a filter changes; the
   setState calls are inside async callbacks rather than the effect body. */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Shell from "../components/Shell";
import "./database.css";

/**
 * The lead database, per client.
 *
 * Reply Radar's version spans every client and has a delete/block danger zone; this one is scoped to
 * one client and has neither. Destroying a lead record is an operational act with consequences for the
 * data every other screen is drawn from, and it belongs in the tool that owns that data.
 */
type Lead = {
  id: string; name: string; role: string; company: string;
  linkedinId: string | null; profileUrl: string | null; photoUrl: string | null;
  email: string | null; location: string | null; headline: string | null; industry: string | null;
  campaignNames: string[]; senderNames: string[];
  icpScore: number | null; icpReason: string | null;
  enrichmentStatus: string | null; enriched: boolean;
  conversationCount: number; replyCount: number;
  lastReplyAt: string | null; createdAt: string;
};

const SORTS: [string, string][] = [
  ["recent", "Newest reply first"],
  ["oldest", "Oldest reply first"],
  ["added-desc", "Recently added"],
  ["added-asc", "Added first"],
  ["replies-desc", "Most replies"],
  ["replies-asc", "Fewest replies"],
  ["name-asc", "Name A–Z"],
  ["name-desc", "Name Z–A"],
];

const PAGE = 50;

function dateParts(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "—", time: "" };
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return { date: "—", time: "" };
  return {
    date: value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    time: value.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
  };
}

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";

function Database() {
  const params = useSearchParams();
  const clientSlug = params.get("client");

  const [leads, setLeads] = useState<Lead[]>([]);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState("recent");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Lead | null>(null);

  // The search box waits for a pause rather than querying on every keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(
    async (nextOffset: number, append: boolean) => {
      setLoading(true);
      try {
        const query = new URLSearchParams({ sort, limit: String(PAGE), offset: String(nextOffset) });
        if (clientSlug) query.set("client", clientSlug);
        if (debounced.trim()) query.set("search", debounced.trim());
        const response = await fetch(`/api/leads?${query.toString()}`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError(payload.error || "The database did not load.");
          return;
        }
        setError("");
        setLeads((previous) => (append ? [...previous, ...(payload.leads ?? [])] : (payload.leads ?? [])));
        setHasMore(Boolean(payload.hasMore));
        setOffset(payload.nextOffset ?? nextOffset);
      } catch {
        setError("The database did not load.");
      } finally {
        setLoading(false);
      }
    },
    [clientSlug, debounced, sort],
  );

  useEffect(() => {
    void load(0, false);
  }, [load]);

  if (!clientSlug && error) {
    return <div className="content"><p className="empty">Pick a client from the directory first.</p></div>;
  }

  return (
    <div className="db-wrap">
      <div className="db-head">
        <div>
          <h1>Lead database</h1>
          <p className="db-count">
            {loading && leads.length === 0 ? "Loading…" : `${leads.length.toLocaleString()} lead${leads.length === 1 ? "" : "s"} loaded${hasMore ? ", more available" : ""}`}
          </p>
        </div>
      </div>

      <section className="db-toolbar">
        <label className="db-search">
          <span>⌕</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, company, title" />
        </label>
        <label className="db-select">
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            {SORTS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        {(search || sort !== "recent") && (
          <button className="db-clear" onClick={() => { setSearch(""); setSort("recent"); }}>Clear filters</button>
        )}
      </section>

      {error && <p className="error-note">{error}</p>}

      <section className="db-card">
        <div className="db-table-head">
          <span>Lead</span><span>Campaign</span><span>Sender</span>
          <span>ICP</span><span>Replies</span><span>Last reply</span><span />
        </div>
        {leads.length === 0 && !loading ? (
          <p className="empty">No leads match.</p>
        ) : (
          leads.map((lead) => {
            const when = dateParts(lead.lastReplyAt);
            return (
              <button key={lead.id} className="db-row" onClick={() => setSelected(lead)}>
                <span className="db-person">
                  <i>{lead.photoUrl ? <img src={lead.photoUrl} alt="" /> : initials(lead.name)}</i>
                  <span>
                    <strong>{lead.name}</strong>
                    <small>{[lead.role, lead.company].filter(Boolean).join(" · ") || "No title or company"}</small>
                  </span>
                </span>
                <span className="db-cell"><b>{lead.campaignNames.join("; ") || "—"}</b></span>
                <span className="db-cell"><b>{lead.senderNames.join("; ") || "—"}</b></span>
                <span className="db-cell db-num"><b>{lead.icpScore ?? "—"}</b></span>
                <span className="db-cell db-num"><b>{lead.replyCount}</b></span>
                <span className="db-cell"><b>{when.date}</b><small>{when.time}</small></span>
                <span className="db-arrow">→</span>
              </button>
            );
          })
        )}
        {loading && leads.length > 0 && <p className="loading">Loading…</p>}
      </section>

      {hasMore && !loading && (
        <button className="db-more" onClick={() => void load(offset, true)}>Load {PAGE} more leads</button>
      )}

      {selected && (
        <div className="db-drawer-backdrop">
          {/* A real button rather than a div with a click handler, so closing the drawer by clicking
              away is reachable from the keyboard and announced as the control it is. */}
          <button className="db-drawer-scrim" aria-label="Close lead details" onClick={() => setSelected(null)} />
          <aside className="db-drawer" role="dialog" aria-label={`Details for ${selected.name}`}>
            <div className="db-drawer-head">
              <span className="db-drawer-avatar">
                {selected.photoUrl ? <img src={selected.photoUrl} alt="" /> : initials(selected.name)}
              </span>
              <div>
                <h2>{selected.name}</h2>
                <p>{[selected.role, selected.company].filter(Boolean).join(" at ") || "No title or company"}</p>
              </div>
              <button className="db-drawer-close" onClick={() => setSelected(null)} aria-label="Close">×</button>
            </div>
            <div className="db-drawer-body">
              <div className="db-fields">
                <Field label="Email" value={selected.email} />
                <Field label="LinkedIn" value={selected.profileUrl} link={selected.profileUrl} />
                <Field label="Location" value={selected.location} />
                <Field label="Industry" value={selected.industry} />
                <Field label="Headline" value={selected.headline} wide />
                <Field label="Campaigns" value={selected.campaignNames.join("; ") || null} wide />
                <Field label="Senders" value={selected.senderNames.join("; ") || null} wide />
                <Field label="ICP score" value={selected.icpScore == null ? null : String(selected.icpScore)} />
                <Field label="Enrichment" value={selected.enrichmentStatus ?? (selected.enriched ? "enriched" : null)} />
                <Field label="Conversations" value={String(selected.conversationCount)} />
                <Field label="Replies" value={String(selected.replyCount)} />
                <Field label="Last reply" value={dateParts(selected.lastReplyAt).date} />
                <Field label="Added" value={dateParts(selected.createdAt).date} />
              </div>
              {selected.icpReason && (
                <div className="db-reason">
                  <small>WHY THIS ICP SCORE</small>
                  <p>{selected.icpReason}</p>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, link, wide }: { label: string; value: string | null; link?: string | null; wide?: boolean }) {
  return (
    <div className={`db-field ${wide ? "wide" : ""}`}>
      <span className="db-field-label">{label}</span>
      <span className="db-field-value">
        {value ? (
          link ? <a href={link} target="_blank" rel="noreferrer">{value}</a> : value
        ) : (
          <em>Not recorded</em>
        )}
      </span>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="loading">Loading…</div>}>
      <Shell>
        <Database />
      </Shell>
    </Suspense>
  );
}
