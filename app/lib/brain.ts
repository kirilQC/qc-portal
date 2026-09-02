// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * Reading the QC Brain — the GitHub repo where weekly call notes are written.
 *
 * ── Read-only, and only two folders of it ───────────────────────────────────────────────────────
 * The brain holds a great deal per client that is internal: strategy notes, competitive research,
 * do-not-contact reasoning, candid assessments. This module can reach exactly two folders per client —
 * the weekly calls and the campaign messaging — and refuses everything else. That is enforced here
 * rather than left to callers, because a path is a string and a bug in a caller would otherwise be a
 * way to read the whole repository.
 *
 * ── Why the folder is found rather than assumed ─────────────────────────────────────────────────
 * Folder names in the brain are written by people: "Campaign messaging", "campaign-messaging" and
 * "Campaign Messaging" are all plausible and only one of them is right for any given client. So the
 * client directory is listed and matched against a pattern, which means a rename does not silently
 * produce an empty page — and when nothing matches, the caller gets to say so specifically.
 *
 * ── No writes ───────────────────────────────────────────────────────────────────────────────────
 * Reply Radar writes these documents; the portal displays them. There is no write path in this file at
 * all, so nothing here can alter the record it renders.
 */

import { clientsIn } from "../../shared/brain-structure.mjs";
import { brainFolderFor } from "../../shared/brain-link.mjs";

const API = "https://api.github.com";
const REPO = "jsbiv18/qc-growth-os";
const TIMEOUT_MS = 15_000;

/**
 * The folders this app may read, each with the pattern that finds it whatever it was actually named.
 * `key` is what a caller asks for; nothing outside this map is reachable.
 */
export const READABLE_FOLDERS = {
  calls: { label: "Weekly calls", match: /^weekly[\s._-]*calls?$/i },
  messaging: { label: "Campaign messaging", match: /^campaign[\s._-]*messaging$/i },
} as const;

export type FolderKey = keyof typeof READABLE_FOLDERS;

export function brainConfigured(): boolean {
  return Boolean(process.env.BRAIN_GITHUB_TOKEN?.trim());
}

function headers() {
  const token = process.env.BRAIN_GITHUB_TOKEN?.trim();
  if (!token) throw new Error("BRAIN_GITHUB_TOKEN is not set, so weekly calls cannot be read.");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/**
 * Refuses any path that is not inside the folder it was resolved from.
 *
 * Checked on every read. `..` is rejected outright rather than resolved, because a resolver that gets
 * it wrong once is a directory traversal, and there is no legitimate reason for one to appear here.
 */
function assertInside(folder: string, subfolder: string, path: string) {
  const prefix = `clients/${folder}/${subfolder}/`;
  if (path.includes("..") || !path.startsWith(prefix)) {
    throw new Error("That document is not in this client's folder.");
  }
}

/** One entry from the GitHub contents API, reduced to what is used here. */
type Entry = { type?: string; name?: string; path?: string; size?: number };

async function contents(path: string): Promise<Entry[] | null> {
  const response = await fetch(`${API}/repos/${REPO}/contents/${encodeURI(path)}`, {
    headers: headers(),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`The brain returned ${response.status} reading ${path}.`);
  const body = (await response.json().catch(() => null)) as unknown;
  return Array.isArray(body) ? (body as Entry[]) : [];
}

/**
 * The real name of one of the readable folders inside a client, or null.
 *
 * Null is a meaningful answer, not a failure: it is how a caller distinguishes "this client has no
 * campaign messaging written yet" from "the brain is unreachable", and those want different messages.
 */
export async function findFolder(clientFolder: string, key: FolderKey): Promise<string | null> {
  if (!clientFolder) return null;
  const listing = await contents(`clients/${clientFolder}`);
  if (!listing) return null;
  const { match } = READABLE_FOLDERS[key];
  const found = listing.find((entry) => entry.type === "dir" && match.test(String(entry.name ?? "")));
  return found ? String(found.name) : null;
}

export type CallFile = {
  /** The full repo path, used to fetch the document itself. */
  path: string;
  /** The file name without its extension. */
  name: string;
  /** The date in the file name, if it starts with one — how these are ordered. */
  date: string | null;
  /** A readable title: the file name with its date prefix and slug dashes removed. */
  title: string;
  size: number;
};

/** `2026-08-14-weekly-sync.md` → date `2026-08-14`, title `Weekly sync`. */
function describe(path: string, size: number): CallFile {
  const file = path.split("/").pop() ?? path;
  const name = file.replace(/\.md$/i, "");
  const match = name.match(/^(\d{4}-\d{2}-\d{2})[-_]?(.*)$/);
  const date = match?.[1] ?? null;
  const rest = (match?.[2] ?? name).replace(/[-_]+/g, " ").trim();
  const title = rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : "Weekly call";
  return { path, name, date, title, size };
}

/**
 * Every markdown document in one of a client's readable folders, newest first.
 *
 * Uses the contents endpoint for that one directory rather than the whole-repo tree: the tree is
 * hundreds of files across every client, and this needs one folder belonging to one of them.
 */
export async function listDocs(clientFolder: string, subfolder: string): Promise<CallFile[]> {
  if (!clientFolder || !subfolder) return [];
  const listing = await contents(`clients/${clientFolder}/${subfolder}`);
  if (!listing) return [];

  return listing
    .filter((entry) => entry.type === "file" && String(entry.name ?? "").toLowerCase().endsWith(".md"))
    .map((entry) => describe(String(entry.path ?? ""), Number(entry.size ?? 0)))
    // Newest first, and anything without a date in its name sinks below everything that has one.
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.title.localeCompare(b.title));
}

/** One document's markdown. */
export async function readDoc(clientFolder: string, subfolder: string, path: string): Promise<string> {
  assertInside(clientFolder, subfolder, path);
  const response = await fetch(`${API}/repos/${REPO}/contents/${encodeURI(path)}`, {
    headers: { ...headers(), Accept: "application/vnd.github.raw" },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 404) throw new Error("That document is no longer in the brain.");
  if (!response.ok) throw new Error(`The brain returned ${response.status} reading that document.`);
  return response.text();
}

// ── The whole client folder ─────────────────────────────────────────────────────────────────────────
//
// The two readers above exist for the Weekly-calls and Messaging tabs, which each open one named
// subfolder. The Brain tab shows the client their *entire* folder, so the functions below read the
// whole `clients/<folder>/` subtree — still read-only, and still walled to that one folder. Every path
// that comes back from a browser is run through `assertClientPath` before a byte is fetched, because a
// path is a string and the boundary is the only thing standing between one client and the next.

/**
 * The single check the whole Brain tab leans on: a path must live inside this client's folder.
 *
 * `..` is rejected outright rather than resolved. There is no legitimate `..` in a repo path from this
 * UI, and a resolver that gets it wrong once is a way to read another client's folder.
 */
export function assertClientPath(clientFolder: string, path: string) {
  const prefix = `clients/${clientFolder}/`;
  if (!clientFolder || path.includes("..") || !path.startsWith(prefix)) {
    throw new Error("That document is not in this client's folder.");
  }
}

export type BrainFile = { path: string; name: string; sha: string; size: number };

/**
 * The whole repository's blob list, cached per-instance for a few minutes.
 *
 * Both the folder listing and the folder-name resolver are built from this, so fetching it once and
 * holding it briefly means opening the Brain tab is one GitHub request, not one per thing it needs to
 * know. The cost of a miss is a single recursive-tree call; the tree changes a few times a day.
 */
let treeCache: { expires: number; rows: BrainFile[] } | null = null;
const TREE_CACHE_MS = 5 * 60_000;

async function fullTree(): Promise<BrainFile[]> {
  if (treeCache && treeCache.expires > Date.now()) return treeCache.rows;
  const response = await fetch(`${API}/repos/${REPO}/git/trees/HEAD?recursive=1`, {
    headers: headers(),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`The brain returned ${response.status} listing the repository.`);
  const data = (await response.json().catch(() => null)) as { tree?: unknown[]; truncated?: boolean } | null;
  if (data?.truncated) throw new Error("The repository is too large to list in one request.");
  const rows = (Array.isArray(data?.tree) ? (data!.tree as Record<string, unknown>[]) : [])
    .filter((row) => row.type === "blob")
    .map((row) => ({ path: String(row.path ?? ""), name: "", sha: String(row.sha ?? ""), size: Number(row.size ?? 0) }))
    .filter((file) => file.path && !file.path.endsWith(".DS_Store"));
  treeCache = { expires: Date.now() + TREE_CACHE_MS, rows };
  return rows;
}

/**
 * Every file in one client's folder, flat.
 *
 * Filtered to this client's prefix here, on the server; nothing outside it is ever returned to the
 * browser. That server-side filter is what keeps one client from seeing another's folder.
 */
export async function brainTree(clientFolder: string): Promise<BrainFile[]> {
  if (!clientFolder) return [];
  const prefix = `clients/${clientFolder}/`;
  return (await fullTree())
    .filter((file) => file.path.startsWith(prefix))
    .map((file) => ({ ...file, name: file.path.slice(prefix.length) }));
}

/** Every client folder name in the brain, for resolving a workspace to the folder it actually is. */
export async function brainClientFolders(): Promise<string[]> {
  const paths = (await fullTree()).map((file) => file.path);
  return clientsIn(paths) as string[];
}

/**
 * The brain folder a workspace actually is, repairing a slug that does not match the folder name.
 *
 * The two systems named the same clients independently — a workspace slug `bluevia` against a folder
 * `bluevia-health` — so the slug is not a reliable folder name. An explicit `brainFolder` on the
 * workspace wins; otherwise the slug and display name are matched against the real folder list the same
 * way Reply Radar does it. Falls back to the slug if nothing matches or the brain is unreachable, which
 * at worst reproduces the old behaviour rather than erroring.
 */
export async function resolveActualFolder(input: { slug: string; name: string; brainFolder: string }): Promise<string> {
  if (input.brainFolder) return input.brainFolder;
  try {
    const folders = await brainClientFolders();
    const { folder } = brainFolderFor(input, folders) as { folder: string };
    return folder || input.slug;
  } catch {
    return input.slug;
  }
}

export type BrainDoc = { path: string; sha: string; text: string };

/** One document's text and the git SHA of it, which the layout cache is keyed on. Scoped and checked. */
export async function readClientDoc(clientFolder: string, path: string): Promise<BrainDoc> {
  assertClientPath(clientFolder, path);
  const response = await fetch(`${API}/repos/${REPO}/contents/${encodeURI(path)}`, {
    headers: headers(),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 404) throw new Error("That document is no longer in the brain.");
  if (!response.ok) throw new Error(`The brain returned ${response.status} reading that document.`);
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!data || Array.isArray(data)) throw new Error("That path is a folder, not a document.");
  const text = Buffer.from(String(data.content ?? ""), "base64").toString("utf8");
  return { path, sha: String(data.sha ?? ""), text };
}

/** Raw bytes for the things that are not markdown — an image, a PDF. Scoped and checked. */
export async function readClientRaw(clientFolder: string, path: string): Promise<{ bytes: ArrayBuffer; type: string }> {
  assertClientPath(clientFolder, path);
  const response = await fetch(`${API}/repos/${REPO}/contents/${encodeURI(path)}`, {
    headers: { ...headers(), Accept: "application/vnd.github.raw" },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`The brain returned ${response.status}.`);
  return { bytes: await response.arrayBuffer(), type: response.headers.get("content-type") || "application/octet-stream" };
}

/**
 * When the folder was first created and last touched, read from its commit history.
 *
 * The file tree has no time in it — every file reads as if it appeared at once — so "engagement
 * started" and "last added" come from `commits?path=clients/<folder>`. The oldest commit sits on the
 * last page of that list, which GitHub names in the Link header, so this is a fixed handful of requests
 * whatever the history's length. Everything is best-effort: a rate limit returns nulls and the page
 * quietly drops the line.
 */
export async function brainClientActivity(clientFolder: string): Promise<{ latestItem: string; latestDate: string; since: string }> {
  const empty = { latestItem: "", latestDate: "", since: "" };
  if (!clientFolder) return empty;
  const prefix = `clients/${clientFolder}`;
  const dateOf = (commit: Record<string, unknown> | undefined) =>
    String((((commit?.commit as Record<string, unknown>)?.author as Record<string, unknown>)?.date) ?? "");
  try {
    const listUrl = `${API}/repos/${REPO}/commits?per_page=1&path=${encodeURIComponent(prefix)}`;
    const head = await fetch(listUrl, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!head.ok) return empty;
    const newest = (await head.json().catch(() => [])) as Array<Record<string, unknown>>;
    const top = newest?.[0];
    if (!top) return empty;
    const latestDate = dateOf(top);
    const sha = String(top.sha ?? "");

    let latestItem = "";
    if (sha) {
      try {
        const detail = (await (await fetch(`${API}/repos/${REPO}/commits/${sha}`, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) })).json()) as Record<string, unknown>;
        const changed = (detail.files as Array<Record<string, unknown>> | undefined) ?? [];
        const first = changed.map((file) => String(file.filename ?? "")).find((path) => path.startsWith(`${prefix}/`));
        if (first) latestItem = first;
      } catch {
        /* the name is a nicety; the date is the fact */
      }
    }

    let since = latestDate;
    const lastMatch = (head.headers.get("link") ?? "").match(/[?&]page=(\d+)[^>]*>;\s*rel="last"/);
    if (lastMatch) {
      try {
        const lastPage = (await (await fetch(`${listUrl}&page=${lastMatch[1]}`, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) })).json()) as Array<Record<string, unknown>>;
        const oldest = lastPage?.[lastPage.length - 1] ?? lastPage?.[0];
        const oldestDate = dateOf(oldest);
        if (oldestDate) since = oldestDate;
      } catch {
        /* fall back to the newest date, which at least bounds the engagement from below */
      }
    }
    return { latestItem, latestDate, since };
  } catch {
    return empty;
  }
}
