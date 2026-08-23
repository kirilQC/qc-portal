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
