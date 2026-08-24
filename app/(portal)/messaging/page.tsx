// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";
/* eslint-disable react-hooks/set-state-in-effect -- loads on mount and when the client changes; the
   setState calls sit inside an async callback rather than the effect body. */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import "./messaging.css";

/**
 * Campaign messaging, read as sequences rather than as documents.
 *
 * ── What changed and why ────────────────────────────────────────────────────────────────────────
 * These files were being rendered as flat markdown, which threw away the only structure that carries
 * meaning. Every one of them has the same spine — a connection request with a character budget, one or
 * two LinkedIn follow-ups, an email follow-up with a subject line and sometimes a variant per sender —
 * and that is the shape of the sequence that actually runs. So the document is parsed into steps
 * (server-side, in shared/messaging.mjs) and the steps are what gets drawn: a rail, a card per touch,
 * the channel and the character count on each.
 *
 * ── Why the campaign's numbers sit above the copy ───────────────────────────────────────────────
 * The whole point of the tab is knowing which messaging belongs to which campaign. Naming the campaign
 * would answer that literally; putting its acceptance, reply and positive rates directly above the words
 * that produced them answers the question somebody actually has.
 *
 * ── Suggested matches are never dressed as certain ──────────────────────────────────────────────
 * A code match is exact and reads as a plain link. A match inferred from the rest of the name reads as
 * "suggested", visibly different, because a fuzzy join presented as fact leaves no way to tell which
 * links to trust.
 */

type Variant = { author: string; body: string; chars: number };
type Step = {
  index: number;
  kind: string;
  channel: "linkedin" | "email" | "inmail";
  label: string;
  subject: string | null;
  body: string;
  chars: number;
  budget: number | null;
  variables: string[];
  variants: Variant[];
};
type Stats = {
  status: string | null;
  launchedAt: string | null;
  totalLeads: number;
  connectionsSent: number;
  connectionsAccepted: number;
  replies: number;
  positiveReplies: number;
  scoredReplies: number;
  acceptanceRate: number;
  replyRate: number;
  positiveReplyRate: number;
};
type Doc = {
  path: string;
  name: string;
  title: string;
  meta: Record<string, string>;
  senders: string[];
  preamble: string;
  steps: Step[];
  campaign: { campaignId: string; name: string; confidence: "exact" | "suggested"; score: number } | null;
  stats: Stats | null;
  error?: string;
};

const CHANNEL_LABEL: Record<string, string> = { linkedin: "LinkedIn", email: "Email", inmail: "InMail" };

function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Live, finished, or nothing to say — the three buckets the index is grouped into. */
function bucketOf(doc: Doc): "live" | "done" | "none" {
  if (!doc.campaign) return "none";
  const status = (doc.stats?.status ?? "").toLowerCase();
  return status.includes("active") || status.includes("running") || status.includes("in_progress") ? "live" : "done";
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Messaging />
    </Suspense>
  );
}

function Messaging() {
  const clientSlug = useSearchParams().get("client");

  const [docs, setDocs] = useState<Doc[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [truncated, setTruncated] = useState(0);
  const [openPath, setOpenPath] = useState("");

  useEffect(() => {
    setLoaded(false);
    setError("");
    setDocs([]);
    setOpenPath("");
    void (async () => {
      try {
        const query = new URLSearchParams();
        if (clientSlug) query.set("client", clientSlug);
        const response = await fetch(`/api/messaging?${query.toString()}`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!payload.ok) {
          setError(payload.error || "That did not load.");
          return;
        }
        const list: Doc[] = payload.docs ?? [];
        setDocs(list);
        setTruncated(payload.truncated ?? 0);
        // Open something worth reading: the first document that is actually a sequence.
        setOpenPath((list.find((doc) => doc.steps.length > 0) ?? list[0])?.path ?? "");
      } catch {
        setError("That did not load.");
      } finally {
        setLoaded(true);
      }
    })();
  }, [clientSlug]);

  /** Grouped for the index, and ordered within each group by campaign launch, newest first. */
  const groups = useMemo(() => {
    const buckets: Record<string, Doc[]> = { live: [], done: [], none: [] };
    for (const doc of docs) buckets[bucketOf(doc)].push(doc);
    const byLaunch = (a: Doc, b: Doc) =>
      (b.stats?.launchedAt ?? "").localeCompare(a.stats?.launchedAt ?? "") || a.title.localeCompare(b.title);
    buckets.live.sort(byLaunch);
    buckets.done.sort(byLaunch);
    buckets.none.sort((a, b) => a.title.localeCompare(b.title));
    return buckets;
  }, [docs]);

  if (!clientSlug && error) {
    return <div className="content"><p className="empty">Pick a client from the directory first.</p></div>;
  }

  const current = docs.find((doc) => doc.path === openPath);

  return (
    <div className="content msg-wide">
      <div className="page-head">
        <h1>Messaging</h1>
      </div>

      {/* The specific reason, not a generic empty state — "not connected", "no such folder" and
          "folder is empty" have three different fixes. */}
      {error && <p className="error-note">{error}</p>}

      {!loaded ? (
        <p className="loading">Loading…</p>
      ) : docs.length === 0 ? (
        !error ? <p className="empty">That folder is there, but no messaging documents have been written into it yet.</p> : null
      ) : (
        <div className="msg-layout">
          <aside className="msg-index">
            <Group label="Live campaigns" docs={groups.live} openPath={openPath} onOpen={setOpenPath} />
            <Group label="Finished" docs={groups.done} openPath={openPath} onOpen={setOpenPath} />
            <Group label="No campaign" docs={groups.none} openPath={openPath} onOpen={setOpenPath} />
            {truncated > 0 && <p className="msg-trunc">{truncated} more not shown.</p>}
          </aside>

          {current ? <Sequence doc={current} /> : <p className="empty">Pick a document.</p>}
        </div>
      )}
    </div>
  );
}

function Group({ label, docs, openPath, onOpen }: {
  label: string; docs: Doc[]; openPath: string; onOpen: (path: string) => void;
}) {
  if (!docs.length) return null;
  return (
    <div className="msg-group">
      <div className="msg-group-head">
        <span>{label}</span>
        <span>{docs.length}</span>
      </div>
      {docs.map((doc) => (
        <button
          key={doc.path}
          className={`msg-item ${openPath === doc.path ? "is-open" : ""}`}
          onClick={() => onOpen(doc.path)}
        >
          <strong>{doc.title}</strong>
          <span>
            {doc.campaign
              ? `${doc.campaign.name}${doc.campaign.confidence === "suggested" ? " · suggested" : ""}`
              : doc.steps.length
                ? "No campaign found"
                : "Note"}
            {doc.steps.length > 0 && ` · ${doc.steps.length} step${doc.steps.length === 1 ? "" : "s"}`}
          </span>
        </button>
      ))}
    </div>
  );
}

/** One document, drawn as the sequence it is. */
function Sequence({ doc }: { doc: Doc }) {
  const synced = doc.meta.last_synced ?? doc.meta.synced ?? null;
  const source = doc.meta.url ?? doc.meta.source_url ?? null;

  return (
    <section className="msg-doc">
      <header className="msg-head">
        <div className="msg-head-top">
          <div>
            <h2>{doc.title}</h2>
            <div className="msg-chips">
              {doc.campaign ? (
                <span className={`msg-chip ${doc.campaign.confidence === "exact" ? "is-linked" : "is-suggested"}`}>
                  <i className="msg-dot" />
                  {doc.campaign.name}
                  {doc.campaign.confidence === "suggested" && <em>suggested</em>}
                </span>
              ) : (
                <span className="msg-chip is-none">No campaign matched</span>
              )}
              {doc.senders.length > 0 && <span className="msg-chip">{doc.senders.join(" & ")}</span>}
              {doc.steps.length > 0 && <span className="msg-chip">{doc.steps.length} step{doc.steps.length === 1 ? "" : "s"}</span>}
            </div>
          </div>
          {(synced || source) && (
            <div className="msg-synced">
              {/* The frontmatter this page used to print as body copy, doing the job it was for. */}
              {synced && <><span className="msg-lbl">Synced</span><span>{shortDate(synced) || synced}</span></>}
              {source && <a href={source} target="_blank" rel="noreferrer noopener">Source doc</a>}
            </div>
          )}
        </div>

        {doc.stats && <Stats stats={doc.stats} />}
      </header>

      {doc.error && <p className="error-note">{doc.error}</p>}

      {doc.preamble && <div className="msg-preamble">{doc.preamble}</div>}

      {doc.steps.length > 0 ? (
        <div className="msg-seq">
          {doc.steps.map((step) => <StepCard key={step.index} step={step} />)}
        </div>
      ) : !doc.preamble && !doc.error ? (
        <p className="empty">This document has no message steps in it.</p>
      ) : null}
    </section>
  );
}

function Stats({ stats }: { stats: Stats }) {
  // Zero classified replies means the positive rate is unknown, not zero — sentiment scoring started
  // partway through this account's history, and "0%" on an unscored campaign is a false accusation.
  const unscored = stats.scoredReplies === 0 && stats.replies > 0;
  return (
    <div className="msg-stats">
      <Stat label="Leads" value={stats.totalLeads.toLocaleString()} />
      <Stat label="Acceptance" value={`${stats.acceptanceRate}%`} pct={stats.acceptanceRate} tone="accepted"
        sub={`${stats.connectionsAccepted.toLocaleString()} of ${stats.connectionsSent.toLocaleString()}`} />
      <Stat label="Reply rate" value={`${stats.replyRate}%`} pct={stats.replyRate} tone="replied"
        sub={`${stats.replies.toLocaleString()} replies`} />
      <Stat label="Positive" value={unscored ? "—" : `${stats.positiveReplyRate}%`}
        pct={unscored ? 0 : stats.positiveReplyRate} tone={unscored ? "muted" : "positive"}
        sub={unscored ? "not scored yet" : `${Math.min(stats.positiveReplies, stats.replies).toLocaleString()} positive`} />
    </div>
  );
}

function Stat({ label, value, sub, pct, tone }: {
  label: string; value: string; sub?: string; pct?: number; tone?: string;
}) {
  return (
    <div className="msg-stat">
      <span className="msg-lbl">{label}</span>
      <strong className={tone ? `t-${tone}` : ""}>{value}</strong>
      {pct !== undefined && (
        <span className="msg-bar"><i className={`t-${tone ?? "muted"}`} style={{ width: `${Math.min(100, pct)}%` }} /></span>
      )}
      {sub && <span className="msg-sub">{sub}</span>}
    </div>
  );
}

function StepCard({ step }: { step: Step }) {
  const over = step.budget !== null && step.chars > step.budget;
  const near = step.budget !== null && !over && step.chars > step.budget * 0.9;

  return (
    <article className={`msg-step ch-${step.channel}`}>
      <div className="msg-card">
        <div className="msg-card-head">
          <span className={`msg-chip ch-${step.channel}`}><i className="msg-dot" />{CHANNEL_LABEL[step.channel] ?? step.channel}</span>
          <b>{step.label}</b>
          {step.variants.length > 0 && (
            <span className="msg-chip is-none">{step.variants.length + 1} versions</span>
          )}
          <span className={`msg-count ${over ? "is-over" : near ? "is-near" : ""}`}>
            {step.budget !== null ? `${step.chars} / ${step.budget}` : `${step.chars} chars`}
          </span>
        </div>
        <div className="msg-card-body">
          {step.subject && (
            <div className="msg-subject">
              <span className="msg-lbl">Subject</span>
              <span>{step.subject}</span>
            </div>
          )}
          <Copy body={step.body} />
          {step.variants.map((variant) => (
            <div className="msg-variant" key={variant.author}>
              <div className="msg-variant-head">
                <span className="msg-lbl">Version from {variant.author}</span>
                <span className="msg-count">{variant.chars} chars</span>
              </div>
              <Copy body={variant.body} />
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

/**
 * A message, with its merge fields marked.
 *
 * The copy is rendered as text and never as markup: these are words somebody will paste into LinkedIn,
 * so what is on screen has to be exactly what gets sent — no emphasis quietly swallowed, no `**` turned
 * into bold that will not survive the paste.
 */
function Copy({ body }: { body: string }) {
  const parts = body.split(/(\{\{?\s*[A-Za-z0-9_ .-]+\s*\}?\})/g);
  return (
    <p className="msg-copy">
      {parts.map((part, index) =>
        /^\{\{?\s*[A-Za-z0-9_ .-]+\s*\}?\}$/.test(part)
          ? <span className="msg-var" key={index}>{part}</span>
          : <span key={index}>{part}</span>,
      )}
    </p>
  );
}
