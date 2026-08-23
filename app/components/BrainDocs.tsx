// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";
/* eslint-disable react-hooks/set-state-in-effect -- loads on mount and when the client changes; the
   setState calls sit inside async callbacks rather than the effect body. */

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * An index of brain documents beside the one being read.
 *
 * Shared by weekly calls and campaign messaging because they are the same thing twice: a folder of
 * markdown somebody wrote, read one at a time, found by date. Writing it once means the two cannot
 * drift into looking like different features.
 *
 * The note is typeset rather than dumped: a reading column, real heading hierarchy, prose line-height.
 * The index beside it stays dense, because its job is to be scanned rather than read.
 */
type Doc = { path: string; name: string; date: string | null; title: string; size: number };

function longDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * The part of markdown these documents actually use: headings, bullets, bold, code and paragraphs.
 *
 * A full parser would be a dependency, and these are written by one generator with a known shape.
 * Anything unrecognised falls through as a paragraph, so an unexpected line stays readable rather than
 * being swallowed.
 */
function Note({ markdown }: { markdown: string }) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];

  const flush = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`}>
        {list.map((item, index) => <li key={index}>{inline(item)}</li>)}
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
    if (/^\s*>\s?/.test(line)) {
      flush();
      blocks.push(<blockquote key={blocks.length}>{inline(line.replace(/^\s*>\s?/, ""))}</blockquote>);
      continue;
    }
    flush();
    blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();

  return <div className="call-note">{blocks}</div>;
}

function inline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    return <span key={index}>{part}</span>;
  });
}

export default function BrainDocs({ folder, title, empty }: { folder: "calls" | "messaging"; title: string; empty: string }) {
  const params = useSearchParams();
  const clientSlug = params.get("client");

  const [docs, setDocs] = useState<Doc[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [openPath, setOpenPath] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [reading, setReading] = useState(false);

  const read = useCallback(
    async (path: string) => {
      setOpenPath(path);
      setReading(true);
      setMarkdown("");
      try {
        const query = new URLSearchParams({ folder, path });
        if (clientSlug) query.set("client", clientSlug);
        const response = await fetch(`/api/brain-docs?${query.toString()}`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (response.ok && payload.ok) setMarkdown(payload.markdown ?? "");
        else setError(payload.error || "That document did not load.");
      } catch {
        setError("That document did not load.");
      } finally {
        setReading(false);
      }
    },
    [clientSlug, folder],
  );

  useEffect(() => {
    setLoaded(false);
    setOpenPath("");
    setMarkdown("");
    setError("");
    void (async () => {
      try {
        const query = new URLSearchParams({ folder });
        if (clientSlug) query.set("client", clientSlug);
        const response = await fetch(`/api/brain-docs?${query.toString()}`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!payload.ok) {
          setError(payload.error || "That did not load.");
          setDocs([]);
          return;
        }
        setDocs(payload.docs ?? []);
        // Open the newest, which is what somebody arriving here usually wants.
        if (payload.docs?.[0]) void read(payload.docs[0].path);
      } catch {
        setError("That did not load.");
      } finally {
        setLoaded(true);
      }
    })();
  }, [clientSlug, folder, read]);

  if (!clientSlug && error) {
    return <div className="content"><p className="empty">Pick a client from the directory first.</p></div>;
  }

  const current = docs.find((doc) => doc.path === openPath);

  return (
    <div className="content calls-wide">
      <div className="page-head">
        <h1>{title}</h1>
      </div>

      {/* The specific reason, not a generic empty state — "not connected", "no such folder" and
          "folder is empty" have three different fixes. */}
      {error && <p className="error-note">{error}</p>}

      {!loaded ? (
        <p className="loading">Loading…</p>
      ) : docs.length === 0 ? (
        !error ? <p className="empty">{empty}</p> : null
      ) : (
        <div className="calls-layout">
          <aside className="calls-list">
            <div className="calls-list-head">{docs.length} document{docs.length === 1 ? "" : "s"}</div>
            {docs.map((doc) => (
              <button
                key={doc.path}
                className={`call-row ${openPath === doc.path ? "is-open" : ""}`}
                onClick={() => void read(doc.path)}
              >
                <strong>{doc.title}</strong>
                {doc.date && <span>{doc.date}</span>}
              </button>
            ))}
          </aside>

          <section className="panel calls-reader">
            <div className="panel-head">
              <h2>{current?.title ?? title}</h2>
              <span>{longDate(current?.date ?? null)}</span>
            </div>
            <div className="calls-body">
              {reading ? <p className="loading">Loading…</p> : markdown ? <Note markdown={markdown} /> : <p className="empty">Pick a document to read.</p>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
