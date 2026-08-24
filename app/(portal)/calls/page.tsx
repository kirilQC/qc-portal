// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";
/* eslint-disable react-hooks/set-state-in-effect -- loads on mount and when the client changes; the
   setState calls sit inside async callbacks rather than the effect body. */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import "./calls.css";
// Plain ESM, shared with the test runner; see shared/calls.mjs.
import { parseCall } from "../../../shared/calls.mjs";

/**
 * Weekly calls, read as calls.
 *
 * ── What this replaces ──────────────────────────────────────────────────────────────────────────
 * The previous page rendered the file as flat markdown, which was wrong three ways. Nine lines of
 * frontmatter printed as body copy. The whole machine transcript — several thousand words of it — was
 * concatenated onto the end of the recap in one scroll. And the recap, which is strongly typed, arrived
 * as undifferentiated grey.
 *
 * ── The header is the frontmatter, doing its job ────────────────────────────────────────────────
 * Unlike the messaging documents, this metadata is worth reading: who was on the call, who ran it, how
 * long it took, whether the recap went to the client. So it becomes a real header rather than being
 * hidden — attendees as initials with the host marked, the rest as chips.
 *
 * ── Action items lead ───────────────────────────────────────────────────────────────────────────
 * The generator writes them third. Its own prompt calls them the most important section and puts the
 * owner first on every line because everybody is scanning for their own name, so they are shown first
 * and the owner is pulled out as a chip.
 *
 * ── The transcript is staff-only and that is enforced on the server ─────────────────────────────
 * A client session never receives it — the route truncates the file before serialising. This component
 * simply never has it to show, which is the only version of that rule worth having.
 */

type Item = { owner: string | null; text: string; sub: string | null };
type Section = { key: string; label: string; icon: string; tone: string; items: Item[] };
type Attendee = { name: string; initials: string; host: boolean };
type Call = {
  title: string;
  date: string | null;
  postedTo: string | null;
  lastSynced: string | null;
  host: string | null;
  durationMinutes: number | null;
  attendees: Attendee[];
  intro: string;
  sections: Section[];
  transcript: string;
  transcriptWords: number;
  actionCount: number;
};
type Doc = { path: string; name: string; date: string | null; title: string; size: number };

function longDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Calls />
    </Suspense>
  );
}

function Calls() {
  const clientSlug = useSearchParams().get("client");

  const [docs, setDocs] = useState<Doc[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [openPath, setOpenPath] = useState("");
  const [call, setCall] = useState<Call | null>(null);
  const [reading, setReading] = useState(false);

  const read = useCallback(async (path: string) => {
    setOpenPath(path);
    setReading(true);
    setCall(null);
    try {
      const query = new URLSearchParams({ folder: "calls", path });
      if (clientSlug) query.set("client", clientSlug);
      const response = await fetch(`/api/brain-docs?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.ok) setCall(parseCall(payload.markdown ?? "") as Call);
      else setError(payload.error || "That call did not load.");
    } catch {
      setError("That call did not load.");
    } finally {
      setReading(false);
    }
  }, [clientSlug]);

  useEffect(() => {
    setLoaded(false);
    setOpenPath("");
    setCall(null);
    setError("");
    void (async () => {
      try {
        const query = new URLSearchParams({ folder: "calls" });
        if (clientSlug) query.set("client", clientSlug);
        const response = await fetch(`/api/brain-docs?${query.toString()}`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!payload.ok) {
          setError(payload.error || "That did not load.");
          setDocs([]);
          return;
        }
        setDocs(payload.docs ?? []);
        // Open the newest, which is what somebody arriving here almost always wants.
        if (payload.docs?.[0]) void read(payload.docs[0].path);
      } catch {
        setError("That did not load.");
      } finally {
        setLoaded(true);
      }
    })();
  }, [clientSlug, read]);

  if (!clientSlug && error) {
    return <div className="content"><p className="empty">Pick a client from the directory first.</p></div>;
  }

  return (
    <div className="content calls-wide">
      <div className="page-head">
        <h1>Weekly calls</h1>
      </div>

      {/* The specific reason, not a generic empty state — "not connected", "no such folder" and
          "folder is empty" have three different fixes. */}
      {error && <p className="error-note">{error}</p>}

      {!loaded ? (
        <p className="loading">Loading…</p>
      ) : docs.length === 0 ? (
        !error ? <p className="empty">No weekly calls have been written into this client&rsquo;s brain folder yet.</p> : null
      ) : (
        <div className="calls-layout">
          {/* A dated spine rather than a list of filenames: these are one conversation, in order. */}
          <aside className="calls-spine">
            {docs.map((doc) => (
              <button
                key={doc.path}
                className={`call-entry ${openPath === doc.path ? "is-open" : ""}`}
                onClick={() => void read(doc.path)}
              >
                <strong>{shortDate(doc.date) || doc.title}</strong>
                <span>{doc.title}</span>
              </button>
            ))}
          </aside>

          <section className="call-doc">
            {reading ? <p className="loading">Loading…</p> : call ? <CallView call={call} /> : <p className="empty">Pick a call.</p>}
          </section>
        </div>
      )}
    </div>
  );
}

function CallView({ call }: { call: Call }) {
  return (
    <>
      <header className="call-head">
        <div className="call-head-top">
          <div className="call-head-id">
            <h2>{call.title}</h2>
            <div className="call-meta">
              {call.date && <span className="chip">{longDate(call.date)}</span>}
              {call.durationMinutes && <span className="chip">{call.durationMinutes} min</span>}
              {call.postedTo && <span className="chip">{call.postedTo}</span>}
              {call.actionCount > 0 && (
                <span className="chip is-act">{call.actionCount} action{call.actionCount === 1 ? "" : "s"}</span>
              )}
            </div>
          </div>

          {call.attendees.length > 0 && (
            <div className="call-who">
              <div className="call-faces">
                {call.attendees.map((person) => (
                  <i
                    key={person.name}
                    className={person.host ? "is-host" : ""}
                    title={person.host ? `${person.name} — host` : person.name}
                  >
                    {person.initials}
                  </i>
                ))}
              </div>
              <span>{call.attendees.length} on the call</span>
            </div>
          )}
        </div>
      </header>

      {call.intro && <p className="call-intro">{call.intro}</p>}

      {call.sections.length === 0 && !call.intro && (
        <p className="empty">No recap was written for this call.</p>
      )}

      {call.sections.map((section) => (
        <SectionCard key={section.key} section={section} />
      ))}

      {/* Staff only, and only because the server sent it — a client's payload has no transcript in it. */}
      {call.transcript && <Transcript text={call.transcript} words={call.transcriptWords} />}
    </>
  );
}

function SectionCard({ section }: { section: Section }) {
  return (
    <article className={`call-sec tone-${section.tone}`}>
      <div className="call-sec-head">
        <span aria-hidden="true">{section.icon}</span>
        <b>{section.label}</b>
        <span className="call-sec-n">{section.items.length}</span>
      </div>
      <div className="call-sec-body">
        {section.items.map((item, index) => (
          <div className="call-item" key={index}>
            <span className="call-item-k">{index + 1}</span>
            <div>
              <p>
                {item.owner && (
                  <span className="call-owner">
                    <i>{initials(item.owner)}</i>
                    {item.owner}
                  </span>
                )}
                {item.text}
              </p>
              {item.sub && <p className="call-item-sub">{item.sub}</p>}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

/** Two letters for an owner chip. Duplicated from the parser deliberately — this one takes a first name. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * The transcript, folded away.
 *
 * A real `<details>` rather than state and a conditional: it is a disclosure, the element exists, and
 * the browser gives keyboard support and the open/closed semantics for nothing. The word count is on
 * the summary so somebody knows what they are opening before they open it.
 */
function Transcript({ text, words }: { text: string; words: number }) {
  return (
    <details className="call-transcript">
      <summary>
        <span aria-hidden="true">📄</span>
        <span className="call-transcript-t">
          <b>Transcript</b>
          <small>Machine transcription of the full call · {words.toLocaleString()} words · staff only</small>
        </span>
        <span className="call-transcript-go">Read it</span>
      </summary>
      <div className="call-transcript-body">{text}</div>
    </details>
  );
}
