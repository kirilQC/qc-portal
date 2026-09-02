// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";
/* eslint-disable react-hooks/set-state-in-effect -- loads on mount and when the client changes; the
   setState calls sit inside async callbacks rather than the effect body. */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useClientSlug } from "../../components/useClientSlug";
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
 * ── The header is the frontmatter, reduced to what earns its place ──────────────────────────────
 * It began as everything the frontmatter carried, attendees included, drawn as initials with the host
 * ringed. That was the wrong read: the same seven people are on every call, so the row said nothing new
 * each week and competed with the subject of the page, which is what was decided. What is left is when
 * the call happened, how long it ran, and how much it owes.
 *
 * ── Action items lead ───────────────────────────────────────────────────────────────────────────
 * The generator writes them third. Its own prompt calls them the most important section and puts the
 * owner first on every line because everybody is scanning for their own name, so they are shown first
 * and the owner is pulled out as a chip.
 *
 * ── The transcript ──────────────────────────────────────────────────────────────────────────────
 * Folded into a disclosure labelled with its length, and shown to clients as well as staff — it is the
 * record of their own call. The copy button lives inside the `<summary>`, which is why it has to stop
 * the click: without that, copying would also close the thing being copied.
 */

type Item = { owner: string | null; text: string; sub: string | null };
type Section = { key: string; label: string; icon: string; tone: string; items: Item[] };
type Call = {
  title: string;
  date: string | null;
  durationMinutes: number | null;
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

/**
 * A date broken into the three pieces the spine draws separately.
 *
 * Returns null when the file name carries no date, which is the case the spine has to fall back on the
 * document's title for — a row that renders an empty tile would look like a loading failure.
 */
function dateParts(iso: string | null): { dow: string; day: string; rest: string } | null {
  if (!iso) return null;
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const at = (options: Intl.DateTimeFormatOptions) => date.toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
  return { dow: at({ weekday: "short" }), day: at({ day: "numeric" }), rest: at({ month: "short", year: "numeric" }) };
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Calls />
    </Suspense>
  );
}

function Calls() {
  const clientSlug = useClientSlug();

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
            {docs.map((doc) => {
              // The title is the same on every call in the folder, so the date is the only thing that
              // tells them apart — which makes it worth setting as a date rather than as a line of text.
              const when = dateParts(doc.date);
              return (
                <button
                  key={doc.path}
                  className={`call-entry ${openPath === doc.path ? "is-open" : ""}`}
                  onClick={() => void read(doc.path)}
                >
                  {when ? (
                    <>
                      <span className="call-entry-day">{when.day}</span>
                      <span className="call-entry-when">
                        <b>{when.dow}</b>
                        <small>{when.rest}</small>
                      </span>
                    </>
                  ) : (
                    <span className="call-entry-when"><b>{doc.title}</b></span>
                  )}
                </button>
              );
            })}
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
        <h2>{call.title}</h2>
        {/* Attendees and the posted-to state were both here and are both gone: the initials read as
            decoration on a page whose subject is what was decided, and every call has the same
            attendees anyway. The metadata that earns its place is when it happened and what it owes. */}
        <div className="call-meta">
          {call.date && <span className="chip">{longDate(call.date)}</span>}
          {call.durationMinutes && <span className="chip">{call.durationMinutes} min</span>}
          {call.actionCount > 0 && (
            <span className="chip is-act">{call.actionCount} action{call.actionCount === 1 ? "" : "s"}</span>
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
 * the browser gives keyboard support and the open/closed semantics for nothing. The word count sits on
 * the summary so somebody knows what they are opening before they open it.
 */
function Transcript({ text, words }: { text: string; words: number }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  /**
   * Copy the whole transcript.
   *
   * `preventDefault` is the load-bearing part: the button lives inside the `<summary>`, and without it
   * every copy would also toggle the disclosure — closing the transcript on the way to copying it.
   */
  const copy = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard access can be refused outright — an insecure origin, a permissions policy, a browser
      // that simply says no. Saying nothing would look like a broken button, so it says so.
      setCopied(false);
      window.alert("Your browser would not let the page copy to the clipboard.");
    }
  };

  return (
    <details className="call-transcript">
      <summary>
        <span aria-hidden="true">📄</span>
        <span className="call-transcript-t">
          <b>Transcript</b>
          <small>Machine transcription of the full call · {words.toLocaleString()} words</small>
        </span>
        <button className={`call-copy ${copied ? "is-done" : ""}`} onClick={copy} type="button">
          {copied ? "Copied" : "Copy"}
        </button>
        <span className="call-transcript-go">Read it</span>
      </summary>
      <div className="call-transcript-body">{text}</div>
    </details>
  );
}
