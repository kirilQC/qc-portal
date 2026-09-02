// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * The Brain tab: a client's own QC Brain folder, laid out to read.
 *
 * The folder is the shared memory we build over an engagement — brief, ICP, personas, voice, live
 * strategy, pipeline, every weekly call. In GitHub it is a grey column of markdown nobody outside the
 * team would open. Here it is a hero, a grid of the documents that make up a client, and a reader that
 * shows each one laid out — headings, figures, tables — with the original one click away.
 *
 * Read-only, by construction: there is no control on this page that writes, and every read is scoped by
 * the session to this one client's folder. The whole thing can also be taken away as a ZIP, which is
 * the off-boarding hand-off.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Markdown from "../../../components/Markdown";
import { useClientSlug } from "../../../components/useClientSlug";
import { agoLabel, clientInitials, clientHue, fileKind, spanLabel } from "../../../../shared/brain-structure.mjs";
import "./brain.css";

type Facts = { label: string; value: string }[];
type Activity = { latestItem: string; latestDate: string; since: string };
type Doc = { key: string; label: string; blurb: string; path: string; present: boolean };
type FileEntry = { path: string; name: string; title: string; kind: string };
type Group = { folder: string; files: FileEntry[] };
type ClientData = {
  folder: string;
  label: string;
  logo: string;
  summary: string;
  facts: Facts;
  activity: Activity;
  fileCount: number;
  coverage: { have: number; total: number; fraction: number };
  docs: Doc[];
  groups: Group[];
};

type RenderWarnings = { figures: string[]; coverage: number; thin: boolean };
type RenderResult = { markdown: string; warnings: RenderWarnings; cached: boolean; model: string } | null;

// The little glyph on each skeleton card, one per slot. Inline SVG paths so there is no icon dependency.
const SLOT_ICON: Record<string, string> = {
  brief: "M6 3h9l4 4v14H6zM15 3v4h4",
  icp: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 8a4 4 0 100 8 4 4 0 000-8zM12 11.5a.5.5 0 100 1 .5.5 0 000-1z",
  personas: "M8 11a3 3 0 100-6 3 3 0 000 6zM2 20c0-3 2.7-5 6-5s6 2 6 5M17 11a3 3 0 100-6M16 15c3 .3 5 2 5 5",
  voice: "M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM5 11a7 7 0 0014 0M12 18v3",
  engagement: "M4 19V5M4 15l5-5 4 4 7-8",
  crm: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6",
  dnc: "M12 3a9 9 0 100 18 9 9 0 000-18zM5.6 5.6l12.8 12.8",
};

const FILE_ICON: Record<string, string> = {
  doc: "M6 3h9l4 4v14H6zM15 3v4h4",
  table: "M4 5h16v14H4zM4 10h16M4 15h16M10 5v14",
  image: "M4 5h16v14H4zM4 16l4-4 3 3 4-5 5 6",
  pdf: "M6 3h9l4 4v14H6zM9 13h2a1.5 1.5 0 000-3H9v6",
  data: "M6 3h9l4 4v14H6zM9 12h6M9 16h6M9 8h3",
  script: "M8 8l-4 4 4 4M16 8l4 4-4 4M13 5l-2 14",
  other: "M6 3h9l4 4v14H6z",
};

function Mark({ label, logo, size }: { label: string; logo: string; size?: "lg" }) {
  if (logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={`brn-mark ${size === "lg" ? "is-lg" : ""}`} src={logo} alt="" />;
  }
  const hue = clientHue(label) as number;
  return (
    <span className={`brn-mark ${size === "lg" ? "is-lg" : ""}`} style={{ background: `hsl(${hue} 42% 30%)`, color: `hsl(${hue} 60% 82%)` }}>
      {clientInitials(label)}
    </span>
  );
}

function Glyph({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

export default function BrainApp() {
  const clientSlug = useClientSlug();
  const [data, setData] = useState<ClientData | null>(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  // What is open: nothing (home), a folder group, or one document.
  const [openFolder, setOpenFolder] = useState<Group | null>(null);
  const [openFile, setOpenFile] = useState<FileEntry | null>(null);
  const [zipping, setZipping] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setError("");
    setOpenFolder(null);
    setOpenFile(null);
    void (async () => {
      try {
        const query = new URLSearchParams();
        if (clientSlug) query.set("client", clientSlug);
        const response = await fetch(`/api/brain?${query.toString()}`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (payload.ok) setData(payload.client as ClientData);
        else {
          setData(null);
          setError(payload.error || "The brain did not load.");
        }
      } catch {
        setError("The brain did not load.");
      } finally {
        setLoaded(true);
      }
    })();
  }, [clientSlug]);

  const downloadZip = useCallback(async () => {
    setZipping(true);
    try {
      const query = new URLSearchParams();
      if (clientSlug) query.set("client", clientSlug);
      const response = await fetch(`/api/brain/zip?${query.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${data?.folder || clientSlug || "brain"}-brain.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("The download could not be built. Try again in a moment.");
    } finally {
      setZipping(false);
    }
  }, [clientSlug, data?.folder]);

  if (!loaded) return <div className="content"><p className="brn-quiet">Opening the brain…</p></div>;
  if (!data) {
    return (
      <div className="content">
        <div className="brn-empty">
          <h1>Your brain</h1>
          <p>{error || "There is nothing here yet."}</p>
        </div>
      </div>
    );
  }

  if (openFile) {
    return <DocView client={data} slug={clientSlug} file={openFile} onBack={() => setOpenFile(null)} />;
  }

  const rootFiles = data.groups.find((group) => group.folder === "")?.files ?? [];
  const folders = data.groups.filter((group) => group.folder !== "");

  if (openFolder) {
    return (
      <div className="content brn">
        <button className="brn-back" onClick={() => setOpenFolder(null)}>← All of {data.label}</button>
        <h1 className="brn-folder-title">{titleCase(openFolder.folder)}</h1>
        <div className="sp-grid">
          {openFolder.files.map((file) => (
            <FileCard key={file.path} file={file} onOpen={() => openEntry(file, setOpenFile)} />
          ))}
        </div>
      </div>
    );
  }

  const openDoc = (doc: Doc) => openEntry({ path: doc.path, name: doc.label, title: doc.label, kind: fileKind(doc.path) as string }, setOpenFile);
  const firstPresent = data.docs.find((doc) => doc.present) ?? null;
  const briefMissing = !data.docs.find((doc) => doc.key === "brief")?.present;
  const lead =
    data.summary ||
    (firstPresent
      ? `Start with the ${firstPresent.label}${briefMissing ? " — no brief written yet" : ""}. ${data.fileCount} files across the folder${data.activity.latestDate ? `, last touched ${agoLabel(data.activity.latestDate)}` : ""}.`
      : `${data.fileCount} files across the folder.`);

  return (
    <div className="content brn">
      {/* The featured lead: who this client is, where to start, and the folder at a glance. */}
      <div className="sp-hero">
        <div className="sp-lead">
          <div className="sp-who">
            <Mark label={data.label} logo={data.logo} size="lg" />
            <div><span className="brn-kicker">Client brain</span><h1>{data.label}</h1></div>
          </div>
          <p className={`sp-start ${data.summary ? "" : "is-empty"}`}>{lead}</p>
          {data.facts.length > 0 && (
            <dl className="sp-facts">
              {data.facts.map((fact) => (
                <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>
              ))}
            </dl>
          )}
          {firstPresent && (
            <button className="sp-cta" onClick={() => openDoc(firstPresent)}>
              <Glyph path="M5 12h14M13 6l6 6-6 6" /> Start reading
            </button>
          )}
        </div>
        <aside className="sp-side">
          <span className="brn-kicker">At a glance</span>
          {data.activity.since && <Stat label="Engagement started" value={`${spanLabel(data.activity.since)} ago`} />}
          {data.activity.latestDate && <Stat label={`Last added · ${agoLabel(data.activity.latestDate)}`} value={fileLabel(data.activity.latestItem, data.folder)} />}
          <Stat label="Core coverage" value={`${data.coverage.have} of ${data.coverage.total}`} />
          <Stat label="Files in folder" value={String(data.fileCount)} />
          <button className="sp-download" onClick={() => void downloadZip()} disabled={zipping}>
            <Glyph path="M12 3v12M7 10l5 5 5-5M5 21h14" />
            {zipping ? "Packaging…" : "Download folder (ZIP)"}
          </button>
        </aside>
      </div>

      {/* The skeleton — each document with a preview of what is actually inside it. */}
      <div className="sp-grid">
        {data.docs.map((doc) => (
          <button
            key={doc.key}
            className={`sp-card ${doc.present ? "" : "off"}`}
            onClick={doc.present ? () => openDoc(doc) : undefined}
            disabled={!doc.present}
          >
            <span className="sp-rail" aria-hidden="true" />
            <span className="sp-card-bd">
              <span className="sp-fic"><Glyph path={SLOT_ICON[doc.key] ?? FILE_ICON.doc} /></span>
              <span className="sp-card-title">{doc.label}</span>
            </span>
          </button>
        ))}
      </div>

      {/* Everything else — folders as banners that peek at their newest files; loose files open directly. */}
      {(folders.length > 0 || rootFiles.length > 0) && (
        <>
          <h2 className="brn-more">More in this folder</h2>
          <div className="sp-band">
            {folders.map((group) => (
              <button key={group.folder} className="sp-folder" onClick={() => setOpenFolder(group)}>
                <span className="sp-folder-ft">
                  <span className="sp-folder-ic"><Glyph path="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></span>
                  <b>{titleCase(group.folder)}</b>
                  <span className="sp-folder-cnt">{group.files.length}</span>
                </span>
                <span className="sp-peek">
                  {group.files.slice(0, 3).map((file) => (
                    <span key={file.path}>{file.title}</span>
                  ))}
                  {group.files.length > 3 && <span className="sp-more">+{group.files.length - 3} more</span>}
                </span>
              </button>
            ))}
            {rootFiles.map((file) => (
              <button key={file.path} className="sp-folder is-file" onClick={() => openEntry(file, setOpenFile)}>
                <span className="sp-folder-ft">
                  <span className="sp-folder-ic"><Glyph path={FILE_ICON[file.kind] ?? FILE_ICON.other} /></span>
                  <b>{file.title}</b>
                </span>
                <span className="sp-peek"><span className="sp-more">{file.kind === "doc" ? "Document" : file.kind}</span></span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="sp-stat">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function FileCard({ file, onOpen }: { file: FileEntry; onOpen: () => void }) {
  return (
    <button className="sp-card" onClick={onOpen}>
      <span className="sp-rail" aria-hidden="true" />
      <span className="sp-card-bd">
        <span className="sp-fic"><Glyph path={FILE_ICON[file.kind] ?? FILE_ICON.other} /></span>
        <span className="sp-card-title">{file.title}</span>
      </span>
    </button>
  );
}

/**
 * One open document.
 *
 * A markdown document is laid out (`/api/brain/render`) and shown through the visual renderer, with the
 * original one click behind a toggle. Anything that is not markdown — an image, a PDF — is shown as
 * itself or linked to download, because pasting a scrape dump into a reading surface helps nobody.
 */
function DocView({ client, slug, file, onBack }: { client: ClientData; slug: string | null; file: FileEntry; onBack: () => void }) {
  const [render, setRender] = useState<RenderResult>(null);
  const [raw, setRaw] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const isDoc = file.kind === "doc";
  const rawUrl = useMemo(() => {
    const query = new URLSearchParams({ path: file.path });
    if (slug) query.set("client", slug);
    return `/api/brain/raw?${query.toString()}`;
  }, [file.path, slug]);

  useEffect(() => {
    if (!isDoc) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    setRender(null);
    setShowRaw(false);
    void (async () => {
      try {
        const response = await fetch(`/api/brain/render`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: file.path, client: slug }),
        });
        const payload = await response.json().catch(() => ({}));
        if (payload.ok) {
          setRender(payload.render ?? null);
          setRaw(payload.raw ?? "");
        } else setError(payload.error || "That document did not open.");
      } catch {
        setError("That document did not open.");
      } finally {
        setLoading(false);
      }
    })();
  }, [file.path, slug, isDoc]);

  const shown = showRaw || !render ? raw : render.markdown;

  return (
    <div className="content brn brn-doc">
      <div className="brn-doc-bar">
        <button className="brn-back" onClick={onBack}>← {client.label}</button>
        <span className="brn-doc-name">{file.title}</span>
        {isDoc && render && (
          <button className="brn-toggle" onClick={() => setShowRaw((value) => !value)}>
            {showRaw ? "Laid out" : "Original"}
          </button>
        )}
      </div>

      {loading && <p className="brn-quiet">Laying it out…</p>}
      {error && <p className="brn-error">{error}</p>}

      {!loading && !error && isDoc && (
        <article className="brn-page">
          <Markdown>{shown}</Markdown>
          {render && !showRaw && (render.warnings.thin || render.warnings.figures.length > 0) && (
            <p className="brn-warn">
              This is a re-laid-out reading of the original.
              {render.warnings.figures.length > 0 && ` Some figures shown (${render.warnings.figures.slice(0, 4).join(", ")}) should be checked against it.`}
              {" "}
              <button className="brn-linkish" onClick={() => setShowRaw(true)}>See the original</button>.
            </p>
          )}
        </article>
      )}

      {!loading && !error && !isDoc && (
        <div className="brn-page">
          {file.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="brn-media" src={rawUrl} alt={file.title} />
          ) : file.kind === "pdf" ? (
            <iframe className="brn-pdf" src={rawUrl} title={file.title} />
          ) : (
            <div className="brn-nonviewable">
              <p>{file.title} is a {file.kind} file — it is part of the folder but not something to read on a page.</p>
              <a className="sp-download" href={rawUrl} download>
                <Glyph path="M12 3v12M7 10l5 5 5-5M5 21h14" /> Download this file
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Helpers ────────────────────────────────────────────────────────────────────────────────────────────

function openEntry(file: FileEntry, setOpenFile: (f: FileEntry) => void) {
  setOpenFile(file);
}

function titleCase(folder: string): string {
  return folder
    .split(/[\/]/)
    .pop()!
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** `clients/willow/feeds/calls/2026-08-14-sync.md` → `Sync`, for the "last added" line. */
function fileLabel(path: string, folder: string): string {
  if (!path) return "";
  const name = path.split("/").pop() ?? path;
  const bare = name.replace(/\.[a-z0-9]+$/i, "").replace(/^\d{4}-\d{2}-\d{2}[-_]?/, "").replace(/[-_]+/g, " ").trim();
  return bare ? bare.charAt(0).toUpperCase() + bare.slice(1) : titleCase(folder);
}
