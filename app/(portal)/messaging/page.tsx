// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";
/* eslint-disable react-hooks/set-state-in-effect -- loads on mount and when the client changes; the
   setState calls sit inside an async callback rather than the effect body. */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
// The funnel's colour tokens and its `.k-*` segment classes live with the campaigns page. Imported
// rather than copied, so the same band is the same colour on both screens by construction.
import "../campaigns/campaigns.css";
import "./messaging.css";
// Plain ESM, shared with the test runner; see shared/messaging.mjs.
import { SORTS, positiveRateOf, replyRateOf, sortDocs, totalChars } from "../../../shared/messaging.mjs";

/**
 * Campaign messaging, read as sequences rather than as documents.
 *
 * ── What the page is for ────────────────────────────────────────────────────────────────────────
 * Two questions, and the layout answers them in order. What are we sending — the sequence, drawn as a
 * rail of typed steps with the channel and character count on each. And how did it do — the campaign's
 * funnel and rates, in the campaigns page's own colours, sitting directly above the copy that produced
 * them.
 *
 * ── Three grades of campaign link, never confused ───────────────────────────────────────────────
 * A code match is exact. A match inferred from the rest of the name is a suggestion. A link a person
 * set by hand is confirmed and outranks both. They are styled differently on purpose: a fuzzy join
 * dressed as a fact leaves no way to tell which links can be trusted.
 */

type Variant = { label: string; author: string; body: string; chars: number };
type Step = {
  index: number;
  kind: string;
  channel: "linkedin" | "email" | "inmail";
  label: string;
  subject: string | null;
  body: string;
  chars: number;
  /** The hard limit a message must stay under to send at all. Only connection requests have one. */
  budget: number | null;
  /** The document's own stated preference, which cannot make anything red. */
  target: number | null;
  variables: string[];
  variants: Variant[];
};
type Stats = {
  status: string | null;
  launchedAt: string | null;
  senders: string[];
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
type Campaign = { campaignId: string; name: string; launchedAt: string | null; status: string | null };
type Doc = {
  path: string;
  name: string;
  title: string;
  meta: Record<string, string>;
  senders: string[];
  preamble: string;
  steps: Step[];
  campaign: { campaignId: string; name: string; confidence: "exact" | "suggested" | "manual"; score: number } | null;
  stats: Stats | null;
  error?: string;
};

const CHANNEL_LABEL: Record<string, string> = { linkedin: "LinkedIn", email: "Email", inmail: "InMail" };
type SortKey = string;

function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function isLive(doc: Doc): boolean {
  const status = (doc.stats?.status ?? "").toLowerCase();
  return status.includes("active") || status.includes("running") || status.includes("in_progress");
}

/** Live, finished, or nothing to say — the three buckets the default order groups into. */
function bucketOf(doc: Doc): "live" | "done" | "none" {
  if (!doc.campaign) return "none";
  return isLive(doc) ? "live" : "done";
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
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [canAttribute, setCanAttribute] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [truncated, setTruncated] = useState(0);
  const [openPath, setOpenPath] = useState("");
  const [sort, setSort] = useState<SortKey>("status");

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
        setCampaigns(payload.campaigns ?? []);
        setCanAttribute(Boolean(payload.canAttribute));
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

  /**
   * Record a hand-set campaign, then reflect it locally.
   *
   * The document's numbers come from the campaign that was picked, which is already in `docs` on
   * whichever document matched it — so the new link can be rendered immediately without re-reading a
   * folder full of markdown that has not changed.
   */
  const attribute = useCallback(async (docPath: string, campaignId: string | null) => {
    const response = await fetch("/api/messaging/link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ docPath, campaignId, client: clientSlug }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!payload.ok) {
      setError(payload.error || "That attribution did not save.");
      return;
    }
    setError("");
    setDocs((current) => {
      const stats = campaignId
        ? current.find((doc) => doc.campaign?.campaignId === campaignId && doc.stats)?.stats ?? null
        : null;
      const chosen = campaigns.find((c) => c.campaignId === campaignId);
      return current.map((doc) =>
        doc.path !== docPath ? doc : {
          ...doc,
          campaign: chosen ? { campaignId: chosen.campaignId, name: chosen.name, confidence: "manual", score: 1 } : null,
          stats: stats ?? (chosen ? doc.stats : null),
        },
      );
    });
  }, [campaigns, clientSlug]);

  const grouped = useMemo(() => {
    const buckets: Record<string, Doc[]> = { live: [], done: [], none: [] };
    for (const doc of docs) buckets[bucketOf(doc)].push(doc);
    const byLaunch = (a: Doc, b: Doc) =>
      (b.stats?.launchedAt ?? "").localeCompare(a.stats?.launchedAt ?? "") || a.title.localeCompare(b.title);
    buckets.live.sort(byLaunch);
    buckets.done.sort(byLaunch);
    buckets.none.sort((a, b) => a.title.localeCompare(b.title));
    return buckets;
  }, [docs]);

  const ordered = useMemo(() => sortDocs(docs, sort) as Doc[], [docs, sort]);

  if (!clientSlug && error) {
    return <div className="content"><p className="empty">Pick a client from the directory first.</p></div>;
  }

  const current = docs.find((doc) => doc.path === openPath);

  return (
    <div className="content msg-wide">
      <div className="page-head msg-page-head">
        <h1>Messaging</h1>
        {docs.length > 0 && (
          <label className="msg-sort">
            <span className="msg-lbl">Sort</span>
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              {(SORTS as [string, string][]).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </label>
        )}
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
            {/* Grouping *is* the default sort, so choosing any other one flattens the list — otherwise a
                ranking by reply rate would be split across three boxes and stop being a ranking. */}
            {sort === "status" ? (
              <>
                <Group label="Live" tone="live" docs={grouped.live} openPath={openPath} onOpen={setOpenPath} sort={sort} />
                <Group label="Finished" docs={grouped.done} openPath={openPath} onOpen={setOpenPath} sort={sort} />
                <Group label="No campaign" docs={grouped.none} openPath={openPath} onOpen={setOpenPath} sort={sort} />
              </>
            ) : (
              <Group label={`${docs.length} documents`} docs={ordered} openPath={openPath} onOpen={setOpenPath} sort={sort} />
            )}
            {truncated > 0 && <p className="msg-trunc">{truncated} more not shown.</p>}
          </aside>

          {current ? (
            <Sequence
              doc={current}
              campaigns={campaigns}
              canAttribute={canAttribute}
              onAttribute={attribute}
            />
          ) : <p className="empty">Pick a document.</p>}
        </div>
      )}
    </div>
  );
}

/**
 * The figure a row shows beneath its title.
 *
 * It follows the sort: ranking by reply rate and then not showing the reply rate would leave the order
 * looking arbitrary. On the default sort the campaign name is the useful thing instead.
 */
function metricFor(doc: Doc, sort: SortKey): string | null {
  if (sort === "longest" || sort === "shortest") {
    const chars = totalChars(doc);
    return chars ? `${chars.toLocaleString()} chars` : null;
  }
  if (sort.startsWith("reply")) {
    const rate = replyRateOf(doc);
    return rate === null ? "no campaign" : `${rate}% reply`;
  }
  if (sort.startsWith("positive")) {
    const rate = positiveRateOf(doc);
    // Two different gaps, said differently, because "not scored" is not "no campaign".
    if (rate === null) return doc.stats ? "not scored" : "no campaign";
    return `${rate}% positive`;
  }
  return null;
}

function Group({ label, tone, docs, openPath, onOpen, sort }: {
  label: string; tone?: string; docs: Doc[]; openPath: string; onOpen: (path: string) => void; sort: SortKey;
}) {
  if (!docs.length) return null;
  return (
    <div className="msg-group">
      <div className="msg-group-head">
        <span className={tone === "live" ? "msg-group-live" : ""}>
          {tone === "live" && <i className="msg-pulse" />}
          {label}
        </span>
        <span>{docs.length}</span>
      </div>
      {docs.map((doc) => {
        // The row is the document's name and nothing else. The campaign and the step count were
        // repeating what the header says the moment you click, and two lines of grey under every title
        // turned the column into a wall. The one exception is the figure being sorted by: rank fifteen
        // documents by reply rate without showing the rate and the order looks arbitrary.
        const metric = metricFor(doc, sort);
        return (
          <button
            key={doc.path}
            className={`msg-item ${openPath === doc.path ? "is-open" : ""}`}
            onClick={() => onOpen(doc.path)}
          >
            <span className="msg-item-title">{doc.title}</span>
            {metric && <span className="msg-item-metric">{metric}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** One document, drawn as the sequence it is. */
function Sequence({ doc, campaigns, canAttribute, onAttribute }: {
  doc: Doc; campaigns: Campaign[]; canAttribute: boolean; onAttribute: (path: string, id: string | null) => void;
}) {
  const synced = doc.meta.last_synced ?? doc.meta.synced ?? null;
  const source = doc.meta.url ?? doc.meta.source_url ?? null;

  return (
    <section className="msg-doc">
      <header className="msg-head">
        <div className="msg-head-top">
          <div className="msg-head-id">
            <h2>{doc.title}</h2>
            <div className="msg-chips">
              {doc.campaign ? (
                <span className={`msg-chip is-${doc.campaign.confidence}`}>
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

          <div className="msg-head-side">
            {(synced || source) && (
              <div className="msg-synced">
                {/* The frontmatter this page used to print as body copy, doing the job it was for. */}
                {synced && <><span className="msg-lbl">Synced</span><span>{shortDate(synced) || synced}</span></>}
                {source && <a href={source} target="_blank" rel="noreferrer noopener">Source doc</a>}
              </div>
            )}
            {canAttribute && (
              <Attribute doc={doc} campaigns={campaigns} onAttribute={onAttribute} />
            )}
          </div>
        </div>

        {doc.stats ? <Performance stats={doc.stats} /> : (
          <p className="msg-nostats">
            No campaign is attached, so there are no numbers to show against this messaging.
            {canAttribute ? " Pick one above if you know which campaign ran it." : ""}
          </p>
        )}
      </header>

      {doc.error && <p className="error-note">{doc.error}</p>}

      {doc.preamble && (
        <div className="msg-preamble">
          <Markdown text={doc.preamble} />
        </div>
      )}

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

/** The campaign picker. Staff only — attribution decides which numbers appear beside which copy. */
function Attribute({ doc, campaigns, onAttribute }: {
  doc: Doc; campaigns: Campaign[]; onAttribute: (path: string, id: string | null) => void;
}) {
  return (
    <label className="msg-attribute">
      <span className="msg-lbl">Campaign</span>
      <select
        value={doc.campaign?.campaignId ?? ""}
        onChange={(event) => onAttribute(doc.path, event.target.value || null)}
      >
        <option value="">— No campaign —</option>
        {campaigns.map((campaign) => (
          <option key={campaign.campaignId} value={campaign.campaignId}>
            {campaign.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The campaign's funnel and rates — the same bar the campaigns page draws, from the same numbers.
 *
 * The audience is the larger of leads loaded and requests sent: HeyReach reports fewer leads than
 * requests once a list has been edited, and a bar its own segments overflow would be worse than a
 * slightly generous denominator.
 */
function Performance({ stats }: { stats: Stats }) {
  const audience = Math.max(stats.totalLeads, stats.connectionsSent, 1);
  const positive = Math.min(stats.positiveReplies, stats.replies);
  const repliedOnly = Math.max(0, stats.replies - positive);
  const acceptedOnly = Math.max(0, stats.connectionsAccepted - stats.replies);
  const reachedOnly = Math.max(0, stats.connectionsSent - stats.connectionsAccepted);
  const untouched = Math.max(0, audience - stats.connectionsSent);
  const share = (value: number) => (value / audience) * 100;

  // Zero classified replies means the positive rate is unknown, not zero — sentiment scoring started
  // partway through this account's history, and "0%" on an unscored campaign is a false accusation.
  const unscored = stats.replies > 0 && stats.scoredReplies === 0;

  return (
    <div className="msg-perf">
      <div className="msg-stats">
        <Stat label="Leads" value={audience.toLocaleString()} />
        <Stat label="Acceptance" value={`${stats.acceptanceRate}%`} tone="accepted"
          sub={`${stats.connectionsAccepted.toLocaleString()} of ${stats.connectionsSent.toLocaleString()}`} />
        <Stat label="Reply rate" value={`${stats.replyRate}%`} tone="replied"
          sub={`${stats.replies.toLocaleString()} replies`} />
        <Stat label="Positive" value={unscored ? "—" : `${stats.positiveReplyRate}%`}
          tone={unscored ? "muted" : "positive"}
          sub={unscored ? "not scored yet" : `${positive.toLocaleString()} positive`} />
      </div>

      <div
        className="cmp-funnel msg-funnel"
        role="img"
        aria-label={`${audience} leads, ${stats.connectionsSent} reached, ${stats.connectionsAccepted} accepted, ${stats.replies} replied, ${positive} positive`}
      >
        {untouched > 0 && <span className="k-untouched" style={{ width: `${share(untouched)}%` }} title={`${untouched.toLocaleString()} not contacted yet`} />}
        {reachedOnly > 0 && <span className="k-reached" style={{ width: `${share(reachedOnly)}%` }} title={`${reachedOnly.toLocaleString()} reached, not accepted`} />}
        {acceptedOnly > 0 && <span className="k-accepted" style={{ width: `${share(acceptedOnly)}%` }} title={`${acceptedOnly.toLocaleString()} accepted, no reply`} />}
        {repliedOnly > 0 && <span className="k-replied" style={{ width: `${share(repliedOnly)}%` }} title={`${repliedOnly.toLocaleString()} replied`} />}
        {positive > 0 && <span className="k-positive" style={{ width: `${share(positive)}%` }} title={`${positive.toLocaleString()} replied positively`} />}
      </div>

      <div className="msg-legend">
        <span><i className="k-reached" />Reached</span>
        <span><i className="k-accepted" />Accepted</span>
        <span><i className="k-replied" />Replied</span>
        <span><i className="k-positive" />Positive</span>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="msg-stat">
      <span className="msg-lbl">{label}</span>
      <strong className={tone ? `t-${tone}` : ""}>{value}</strong>
      {sub && <span className="msg-sub">{sub}</span>}
    </div>
  );
}

function StepCard({ step }: { step: Step }) {
  // A step may hold one message, or several A/B versions of the same message. Where there are versions
  // there is no single character count to show — three messages do not have one length — so the header
  // says how many there are and each version carries its own count.
  const versions = step.variants;
  const hasBody = step.body.trim().length > 0;

  return (
    <article className={`msg-step ch-${step.channel}`}>
      <div className="msg-card">
        <div className="msg-card-head">
          <span className={`msg-chip ch-${step.channel}`}><i className="msg-dot" />{CHANNEL_LABEL[step.channel] ?? step.channel}</span>
          <b>{step.label}</b>
          {versions.length > 1 && <span className="msg-chip is-none">{versions.length} versions</span>}
          <span className="msg-counts">
            {step.target !== null && step.target !== step.budget && (
              <span className="msg-target" title="The target this document sets for itself">target {step.target}</span>
            )}
            {hasBody && <Count chars={step.chars} budget={step.budget} />}
          </span>
        </div>
        <div className="msg-card-body">
          {step.subject && (
            <div className="msg-subject">
              <span className="msg-lbl">Subject</span>
              <span>{step.subject}</span>
            </div>
          )}
          {hasBody && <Copy body={step.body} />}
          {versions.map((version, index) => (
            <div className={`msg-variant ${!hasBody && index === 0 ? "is-first" : ""}`} key={`${version.label}-${index}`}>
              <div className="msg-variant-head">
                <span className="msg-variant-label">{version.label}</span>
                <Count chars={version.chars} budget={step.budget} />
              </div>
              <Copy body={version.body} />
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

/**
 * A character count, measured against a hard limit where one exists.
 *
 * Only a limit can turn this red: over it the message will not send. A house target of 250 is a
 * preference, and flagging a sendable 265-character request as broken was simply wrong.
 */
function Count({ chars, budget }: { chars: number; budget: number | null }) {
  const over = budget !== null && chars > budget;
  const near = budget !== null && !over && chars > budget * 0.92;
  return (
    <span className={`msg-count ${over ? "is-over" : near ? "is-near" : ""}`}>
      {budget !== null ? `${chars} / ${budget}` : `${chars} chars`}
    </span>
  );
}

/**
 * A message, with its merge fields marked.
 *
 * Rendered as text and never as markup: these are words somebody will paste into LinkedIn, so what is
 * on screen has to be exactly what gets sent — no emphasis quietly swallowed, no `**` turned into bold
 * that will not survive the paste.
 */
function Copy({ body }: { body: string }) {
  const parts = body.split(/(\{\{?\s*[A-Za-z0-9_ .-]+\s*\}?\}|\[[A-Za-z][A-Za-z ]{1,20}\])/g);
  return (
    <p className="msg-copy">
      {parts.map((part, index) =>
        /^(\{\{?\s*[A-Za-z0-9_ .-]+\s*\}?\}|\[[A-Za-z][A-Za-z ]{1,20}\])$/.test(part)
          ? <span className="msg-var" key={index}>{part}</span>
          : <span key={index}>{part}</span>,
      )}
    </p>
  );
}

/**
 * The little markdown these preambles use — headings, bullets and bold.
 *
 * Unlike the message copy above, this part *is* prose: targeting notes, reference lists, reminders. It
 * was being printed raw, so a reader got literal `**TARGETING (FOR REFERENCE)**` and a column of
 * hyphens. Indentation is preserved as nesting depth, because these lists are outlines and losing the
 * levels turns a hierarchy into a flat list of unrelated roles.
 */
function Markdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let bullets: { depth: number; text: string }[] = [];

  const flush = () => {
    if (!bullets.length) return;
    const items = bullets;
    bullets = [];
    blocks.push(
      <ul key={`ul-${blocks.length}`}>
        {items.map((item, index) => (
          <li key={index} style={{ marginLeft: `${Math.min(item.depth, 4) * 15}px` }}>{inline(item.text)}</li>
        ))}
      </ul>,
    );
  };

  for (const raw of text.split("\n")) {
    if (!raw.trim()) { flush(); continue; }

    const heading = raw.match(/^\s*(#{1,4})\s+(.*)$/);
    if (heading) { flush(); blocks.push(<h4 key={blocks.length}>{inline(heading[2])}</h4>); continue; }

    const bullet = raw.match(/^(\s*)[-*+•]\s+(.*)$/);
    if (bullet) { bullets.push({ depth: Math.floor(bullet[1].length / 2), text: bullet[2] }); continue; }

    // A line that is entirely bold reads as a heading in these documents.
    const strong = raw.trim().match(/^\*\*(.+)\*\*:?$/);
    if (strong) { flush(); blocks.push(<h4 key={blocks.length}>{strong[1]}</h4>); continue; }

    flush();
    blocks.push(<p key={blocks.length}>{inline(raw.trim())}</p>);
  }
  flush();

  return <>{blocks}</>;
}

function inline(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    return <span key={index}>{part}</span>;
  });
}
