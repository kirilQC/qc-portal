// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";
/* eslint-disable react-hooks/set-state-in-effect -- loads on mount and when the client changes; the
   setState calls sit inside async callbacks rather than the effect body. */

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import "./calls.css";

/**
 * Every weekly call with a client, kept so any of them can be re-read later.
 *
 * A list on the left and the note on the right: these are read one at a time, and the list is how you
 * find the week you half-remember. The note renders as prose rather than raw markdown, because a call
 * note is a document somebody wrote, not a payload.
 */
type Call = { path: string; name: string; date: string | null; title: string; size: number };

function longDate(iso: string | null): string {
  if (!iso) return "Date not in the file name";
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * The small part of markdown these notes actually use: headings, bullets, bold, and paragraphs.
 *
 * A full parser would be a dependency, and these documents are written by one generator with a known
 * shape. Anything unrecognised falls through as a paragraph, so an unexpected line is still readable
 * rather than swallowed.
 */
function Note({ markdown }: { markdown: string }) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];

  const flush = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`}>
        {list.map((item, index) => (
          <li key={index}>{inline(item)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flush();
      const level = heading[1].length;
      const text = inline(heading[2]);
      blocks.push(
        level <= 1 ? <h1 key={blocks.length}>{text}</h1> :
        level === 2 ? <h2 key={blocks.length}>{text}</h2> :
        level === 3 ? <h3 key={blocks.length}>{text}</h3> :
        <h4 key={blocks.length}>{text}</h4>,
      );
      continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      list.push(bullet[1]);
      continue;
    }
    flush();
    blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();

  return <div className="call-note">{blocks}</div>;
}

/** Bold and inline code, which is all these notes use inside a line. */
function inline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    return <span key={index}>{part}</span>;
  });
}

function Calls() {
  const params = useSearchParams();
  const clientSlug = params.get("client");

  const [calls, setCalls] = useState<Call[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [openPath, setOpenPath] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [reading, setReading] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setOpenPath("");
    setMarkdown("");
    void (async () => {
      try {
        const query = clientSlug ? `?client=${encodeURIComponent(clientSlug)}` : "";
        const response = await fetch(`/api/calls${query}`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError(payload.error || "Weekly calls did not load.");
          return;
        }
        setError("");
        setCalls(payload.calls ?? []);
        // Open the most recent one, which is the one somebody arriving here usually wants.
        if (payload.calls?.[0]) void open(payload.calls[0].path);
      } catch {
        setError("Weekly calls did not load.");
      } finally {
        setLoaded(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `open` is stable for a given client
  }, [clientSlug]);

  async function open(path: string) {
    setOpenPath(path);
    setReading(true);
    setMarkdown("");
    try {
      const query = new URLSearchParams({ path });
      if (clientSlug) query.set("client", clientSlug);
      const response = await fetch(`/api/calls?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) setMarkdown(payload.markdown ?? "");
      else setError(payload.error || "That call note did not load.");
    } catch {
      setError("That call note did not load.");
    } finally {
      setReading(false);
    }
  }

  if (!clientSlug && error) {
    return <div className="content"><p className="empty">Pick a client from the directory first.</p></div>;
  }

  const current = calls.find((call) => call.path === openPath);

  return (
    <div className="content calls-wide">
      <div className="page-head">
        <span className="eyebrow">Internal</span>
        <h1>Weekly calls</h1>
      </div>

      {error && <p className="error-note">{error}</p>}

      {!loaded ? (
        <p className="loading">Loading…</p>
      ) : calls.length === 0 ? (
        <p className="empty">No weekly call notes have been written for this client yet.</p>
      ) : (
        <div className="calls-layout">
          <aside className="calls-list">
            <div className="calls-list-head">{calls.length} call{calls.length === 1 ? "" : "s"}</div>
            {calls.map((call) => (
              <button
                key={call.path}
                className={`call-row ${openPath === call.path ? "is-open" : ""}`}
                onClick={() => void open(call.path)}
              >
                <strong>{call.date ?? "Undated"}</strong>
                <span>{call.title}</span>
              </button>
            ))}
          </aside>

          <section className="panel calls-reader">
            <div className="panel-head">
              <h2>{current?.title ?? "Call note"}</h2>
              <span>{longDate(current?.date ?? null)}</span>
            </div>
            <div className="calls-body">
              {reading ? <p className="loading">Loading the note…</p> : markdown ? <Note markdown={markdown} /> : <p className="empty">Pick a call to read.</p>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Calls />
    </Suspense>
  );
}
