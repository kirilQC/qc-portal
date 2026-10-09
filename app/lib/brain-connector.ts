// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * A client's own Claude, connected to the QC Brain folder QC keeps on them.
 *
 * ── What it is ──────────────────────────────────────────────────────────────────────────────────
 * A remote connector (MCP) the client adds to Claude once, by a secret link from the Brain tab. Their
 * Claude can then list, read and search everything in their folder, which is what the Brain tab shows,
 * and write into one place only: `from-client/` inside that folder. Nothing outside the folder exists as
 * far as the connector is concerned.
 *
 * ── Why a link and not GitHub access ────────────────────────────────────────────────────────────
 * GitHub permissions are per repository, and the brain is one repository for every client, so any access
 * there would show every client. The link stands in for a key: it names one workspace, is stored only as
 * a hash, and regenerating it from the Brain tab makes the old one stop working.
 *
 * ── Why writes are fenced to one folder ─────────────────────────────────────────────────────────
 * QC's own Claudes read these folders with tools in hand. What a client writes is their input, kept apart
 * in `from-client/`, so QC's assistants can treat it as the client's words rather than QC's standing
 * context, and the client can never rewrite QC's documents.
 */
import { createHash, createHmac } from "node:crypto";
import { adminRows, adminWrite, str } from "./db";
import { brainTree, forgetBrainTree, readClientDoc, resolveActualFolder } from "./brain";

const REPO = "jsbiv18/qc-growth-os";
const API = "https://api.github.com";
export const CLIENT_CORNER = "from-client";
const MAX_NOTE = 200_000;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export type Connector = { workspaceId: string; name: string; slug: string; folder: string };

/**
 * The link is derived, not random: an HMAC of the workspace and the moment the link was made, keyed by the
 * server's secret. So the Brain tab can show a client their link every time without the link being kept
 * anywhere (only its hash is stored), and making a new one (a new moment) turns the old one off.
 */
function tokenFor(workspaceId: string, madeAt: string): string {
  const secret = (process.env.SESSION_SECRET || "").trim();
  if (!secret) throw new Error("The portal has no SESSION_SECRET, so links can't be made.");
  const mac = createHmac("sha256", secret).update(`qc-brain-link|${workspaceId}|${Date.parse(madeAt)}`).digest("base64url");
  return `qcb_${mac.slice(0, 32)}`;
}

/** A new link for this client; the old one stops working. */
export async function issueConnector(workspaceId: string, by: string): Promise<{ token: string; last4: string }> {
  const madeAt = new Date().toISOString();
  const token = tokenFor(workspaceId, madeAt);
  const saved = await adminWrite("rr_brain_connectors", "POST", {
    workspace_id: workspaceId,
    token_hash: hash(token),
    token_last4: token.slice(-4),
    created_at: madeAt,
    created_by: by,
    last_used_at: null,
  }, {}, ["resolution=merge-duplicates"]);
  if (!saved.ok) throw new Error(`Could not save the connection link: ${saved.error}`);
  return { token, last4: token.slice(-4) };
}

/** This client's link, made the first time it's asked for. */
export async function linkFor(workspaceId: string, by: string): Promise<string> {
  const [row] = await adminRows("rr_brain_connectors", { select: "token_hash,created_at", workspace_id: `eq.${workspaceId}`, limit: "1" });
  if (row) {
    const token = tokenFor(workspaceId, str(row.created_at));
    if (hash(token) === str(row.token_hash)) return token;
  }
  // None yet, or one from before links were derived: make one this page can show.
  return (await issueConnector(workspaceId, by)).token;
}

/** Whether this client has a link, when it was made and last used (never the link itself). */
export async function connectorStatus(workspaceId: string): Promise<{ exists: boolean; last4: string; createdAt: string; lastUsedAt: string }> {
  const [row] = await adminRows("rr_brain_connectors", { select: "token_last4,created_at,last_used_at", workspace_id: `eq.${workspaceId}`, limit: "1" });
  return { exists: Boolean(row), last4: str(row?.token_last4), createdAt: str(row?.created_at), lastUsedAt: str(row?.last_used_at) };
}

/** Turns the client's link off. */
export async function revokeConnector(workspaceId: string): Promise<void> {
  await adminWrite("rr_brain_connectors", "DELETE", null, { workspace_id: `eq.${workspaceId}` });
}

/** The client a link belongs to, with their folder, or null for an unknown or revoked link. */
export async function connectorFor(token: string): Promise<Connector | null> {
  if (!/^qcb_[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  const [row] = await adminRows("rr_brain_connectors", { select: "workspace_id", token_hash: `eq.${hash(token)}`, limit: "1" });
  if (!row) return null;
  const workspaceId = str(row.workspace_id);
  const [workspace] = await adminRows("rr_workspaces", { select: "id,slug,name,brain_folder,offboarded_at", id: `eq.${workspaceId}`, limit: "1" });
  if (!workspace) return null;
  const folder = await resolveActualFolder({ slug: str(workspace.slug), name: str(workspace.name), brainFolder: str(workspace.brain_folder) });
  if (!folder) return null;
  // Best effort: when the link was last used, for the Brain tab.
  void adminWrite("rr_brain_connectors", "PATCH", { last_used_at: new Date().toISOString() }, { workspace_id: `eq.${workspaceId}` }).catch(() => undefined);
  return { workspaceId, name: str(workspace.name), slug: str(workspace.slug), folder };
}

/**
 * Plain file-name characters only. Anything else (`?`, `#`, `%`, control characters, a backslash) is
 * refused rather than escaped: none belongs in a brain path, and each is a way to make a path mean
 * something other than it looks like to the GitHub API.
 */
const SAFE_PATH = /^[\p{L}\p{N} _.,'&()+\-/]+$/u;

/** A path the client gave, relative to their folder, made into a repo path inside it (or refused). */
export function inFolder(folder: string, relative: string): string {
  const clean = relative.trim().replace(/^\/+/, "").replace(/^clients\/[^/]+\//, "");
  if (!clean || clean.length > 300 || clean.includes("..") || !SAFE_PATH.test(clean) || clean.split("/").some((part) => !part.trim())) {
    throw new Error("That path isn't in this client's folder.");
  }
  return `clients/${folder}/${clean}`;
}

/** Each path segment encoded on its own, so nothing in a name is read as URL syntax by GitHub. */
const repoPath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/**
 * A ceiling per link, so a client's Claude stuck in a loop can't use up the GitHub allowance QC's own
 * tools share. Per server instance: approximate across instances, which is enough to stop a runaway.
 */
const windows = new Map<string, { start: number; requests: number; writes: number }>();
export function overLimit(workspaceId: string, write: boolean): string {
  const now = Date.now();
  let entry = windows.get(workspaceId);
  if (!entry || now - entry.start > 60 * 60_000) { entry = { start: now, requests: 0, writes: 0 }; windows.set(workspaceId, entry); }
  entry.requests += 1;
  if (write) entry.writes += 1;
  if (entry.requests > 600) return "Too many requests to the QC Brain this hour. Try again later.";
  if (write && entry.writes > 60) return "Too many notes saved this hour. Try again later.";
  return "";
}

/** Every file in the folder, relative, with whether the client wrote it. */
export async function listFiles(folder: string): Promise<Array<{ path: string; size: number; fromClient: boolean }>> {
  return (await brainTree(folder)).map((file) => ({ path: file.name, size: file.size, fromClient: file.name.startsWith(`${CLIENT_CORNER}/`) }));
}

const textCache = new Map<string, string>();

/** One document's text by its path relative to the folder. */
export async function readFile(folder: string, relative: string): Promise<string> {
  const doc = await readClientDoc(folder, inFolder(folder, relative));
  return doc.text;
}

/** Lines matching every word of the query across the folder's text documents, newest-first order of the tree. */
export async function searchFolder(folder: string, query: string): Promise<Array<{ path: string; line: number; text: string }>> {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 1).slice(0, 8);
  if (!words.length) throw new Error("Search for at least one word.");
  const files = (await brainTree(folder)).filter((file) => /\.(md|markdown|txt|csv|json)$/i.test(file.name) && file.size < 400_000).slice(0, 120);
  const hits: Array<{ path: string; line: number; text: string }> = [];
  for (let i = 0; i < files.length && hits.length < 60; i += 8) {
    const batch = await Promise.all(files.slice(i, i + 8).map(async (file) => {
      const cached = textCache.get(file.sha);
      if (cached !== undefined) return { file, text: cached };
      const text = await readClientDoc(folder, file.path).then((doc) => doc.text).catch(() => "");
      if (textCache.size > 2000) textCache.clear();
      textCache.set(file.sha, text);
      return { file, text };
    }));
    for (const { file, text } of batch) {
      text.split("\n").forEach((line, index) => {
        const lower = line.toLowerCase();
        if (hits.length < 60 && words.every((word) => lower.includes(word))) hits.push({ path: file.name, line: index + 1, text: line.trim().slice(0, 300) });
      });
    }
  }
  return hits;
}

/**
 * Writes a note into the client's own corner, `from-client/`, creating or replacing it. Markdown or text
 * only. Nothing outside that subfolder can be written, whatever path is given.
 */
export async function writeClientNote(connector: Connector, relative: string, content: string): Promise<{ path: string; created: boolean }> {
  // Paths the way reads take them ("clients/<any>/from-client/x.md") come down to the note's own name,
  // so a client-style path can never make a folder that looks like another client's inside this one.
  let name = relative.trim().replace(/^\/+/, "").replace(/^clients\/[^/]+\//, "").replace(new RegExp(`^${CLIENT_CORNER}/`), "");
  if (!name || name.length > 200 || name.includes("..") || !SAFE_PATH.test(name) || name.split("/").some((part) => !part.trim() || part.startsWith("."))) throw new Error("Give the note a simple name, like meeting-notes.md.");
  if (!/\.(md|markdown|txt)$/i.test(name)) name = `${name}.md`;
  if (content.length > MAX_NOTE) throw new Error("That note is too long (200,000 characters at most).");
  const path = `clients/${connector.folder}/${CLIENT_CORNER}/${name}`;
  const token = (process.env.BRAIN_GITHUB_WRITE_TOKEN || process.env.BRAIN_GITHUB_TOKEN || "").trim();
  if (!token) throw new Error("The brain isn't connected for writing yet.");
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const existing = await fetch(`${API}/repos/${REPO}/contents/${repoPath(path)}`, { headers, cache: "no-store" });
  const sha = existing.ok ? str(((await existing.json().catch(() => ({}))) as Record<string, unknown>).sha) : "";
  const response = await fetch(`${API}/repos/${REPO}/contents/${repoPath(path)}`, {
    method: "PUT",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      message: `${connector.name}: ${sha ? "update" : "add"} ${CLIENT_CORNER}/${name} (from the client's Claude, via QC Portal)`,
      content: Buffer.from(content, "utf8").toString("base64"),
      ...(sha ? { sha } : {}),
      committer: { name: "QC Portal (client)", email: "portal@qcgrowth.com" },
    }),
  });
  if (response.status === 403 || response.status === 404) throw new Error("QC's brain isn't open for client writes yet. Ask QC Growth to enable it.");
  if (!response.ok) throw new Error(`The note couldn't be saved (${response.status}).`);
  forgetBrainTree();
  return { path: `${CLIENT_CORNER}/${name}`, created: !sha };
}
