// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * Which brain folder this request is allowed to read — the single gate every Brain route passes through.
 *
 * The whole read-only, one-client guarantee rests here: the folder is derived from the session, never
 * from anything the browser sent. `resolveScope` already pins a client session to its own workspace and
 * ignores a `?client=` naming someone else, so a client cannot ask for another folder even by editing
 * the URL — they get their own, every time. Staff may name a client, and when they do they see exactly
 * what that client sees. A path that later comes back from the browser is still re-checked against this
 * folder in `app/lib/brain.ts` before a byte is fetched.
 */
import { resolveScope } from "./auth-context";
import { scopedRows, str } from "./db";

export type ClientFolder = { folder: string; name: string; logo: string; slug: string };

export async function resolveClientFolder(slug?: string | null): Promise<ClientFolder | null> {
  const { session, workspaceId } = await resolveScope(slug);
  if (!workspaceId) return null;
  const rows = await scopedRows(session, "rr_workspaces", { select: "brain_folder,slug,name,logo_url", limit: "1" }, workspaceId);
  const row = rows[0];
  if (!row) return null;
  // The folder is what most clients are named after; `brain_folder` overrides it when they differ.
  const folder = str(row.brain_folder) || str(row.slug);
  return { folder, name: str(row.name), logo: str(row.logo_url), slug: str(row.slug) };
}
