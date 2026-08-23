// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * Reading the QC Brain — the GitHub repo where weekly call notes are written.
 *
 * ── Read-only, and only one folder of it ────────────────────────────────────────────────────────
 * The brain holds a great deal per client that is internal: strategy notes, competitive research,
 * do-not-contact reasoning, candid assessments. This module can reach exactly one path per client —
 * `clients/<folder>/Weekly calls/` — and refuses anything else. That is enforced here rather than left
 * to the caller, because a path is a string and a bug in a caller would otherwise be a way to read the
 * whole repository.
 *
 * ── No writes ───────────────────────────────────────────────────────────────────────────────────
 * Reply Radar writes these documents; the portal displays them. There is no write path in this file at
 * all, so nothing here can alter the record it renders.
 */

const API = "https://api.github.com";
const REPO = "jsbiv18/qc-growth-os";
const TIMEOUT_MS = 15_000;

/** The one folder, per client, that this app may read. */
const CALLS_FOLDER = "Weekly calls";

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
 * Refuses any path that is not inside this client's own calls folder.
 *
 * Checked on every read. `..` is rejected outright rather than resolved, because a resolver that gets
 * it wrong once is a directory traversal, and there is no legitimate reason for one to appear here.
 */
function assertInCallsFolder(folder: string, path: string) {
  const prefix = `clients/${folder}/${CALLS_FOLDER}/`;
  if (path.includes("..") || !path.startsWith(prefix)) {
    throw new Error("That document is not one of this client's weekly calls.");
  }
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
 * Every weekly call for one client, newest first.
 *
 * Uses the contents endpoint for the single folder rather than the whole-repo tree: the tree is hundreds
 * of files across every client, and this needs one directory belonging to one of them.
 */
export async function listCalls(folder: string): Promise<CallFile[]> {
  if (!folder) return [];
  const path = `clients/${folder}/${CALLS_FOLDER}`;
  const response = await fetch(`${API}/repos/${REPO}/contents/${encodeURI(path)}`, {
    headers: headers(),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // A client with no calls yet has no folder, which is a 404 and not an error worth surfacing.
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`The brain returned ${response.status} listing weekly calls.`);

  const body = (await response.json().catch(() => [])) as unknown;
  if (!Array.isArray(body)) return [];

  return body
    .filter((entry) => {
      const row = entry as Record<string, unknown>;
      return row.type === "file" && String(row.name ?? "").toLowerCase().endsWith(".md");
    })
    .map((entry) => {
      const row = entry as Record<string, unknown>;
      return describe(String(row.path ?? ""), Number(row.size ?? 0));
    })
    // Newest first, and anything without a date in its name sinks below everything that has one.
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

/** One call document's markdown. */
export async function readCall(folder: string, path: string): Promise<string> {
  assertInCallsFolder(folder, path);
  const response = await fetch(`${API}/repos/${REPO}/contents/${encodeURI(path)}`, {
    headers: { ...headers(), Accept: "application/vnd.github.raw" },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 404) throw new Error("That call note is no longer in the brain.");
  if (!response.ok) throw new Error(`The brain returned ${response.status} reading that call.`);
  return response.text();
}
