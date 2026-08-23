// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * The weekly calls held with one client.
 *
 * ── Visible to the client, by decision ──────────────────────────────────────────────────────────
 * These are notes from calls held *with* the client, so they are shared with them — which is the call
 * that was made, knowingly. It is worth stating the consequence plainly: these documents are written in
 * the QC Brain for whoever picks the account up next, and anything candid written in one is now
 * something the client can read. The safeguard is scope, not secrecy — a session can reach exactly one
 * folder, belonging to exactly the client it already had access to, and nothing else in the repo.
 *
 * Which folder to read comes from the workspace row through the scoped path, so a session can only ever
 * reach the brain folder of a client it already had access to.
 */
import { NextResponse } from "next/server";
import { currentSession, resolveScope } from "../../lib/auth-context";
import { scopedRows, str } from "../../lib/db";
import { brainConfigured, listCalls, readCall } from "../../lib/brain";

export const maxDuration = 30;

/** The brain folder for the client in scope, or "" if there is none. */
async function folderFor(slug: string | null) {
  const { session, workspaceId } = await resolveScope(slug);
  if (!workspaceId) return { session, folder: "", workspaceId: null };
  const rows = await scopedRows(session, "rr_workspaces", { select: "brain_folder,slug", limit: "1" }, workspaceId);
  const row = rows[0];
  // Falls back to the slug, which is what the brain folder is named for most clients.
  return { session, folder: str(row?.brain_folder) || str(row?.slug), workspaceId };
}

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!brainConfigured()) {
    return NextResponse.json(
      { ok: false, error: "The QC Brain is not connected. Set BRAIN_GITHUB_TOKEN in the environment." },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const slug = url.searchParams.get("client");
  const wanted = url.searchParams.get("path");

  try {
    const { folder, workspaceId } = await folderFor(slug);
    if (!workspaceId) return NextResponse.json({ ok: false, error: "Pick a client first." }, { status: 400 });
    if (!folder) return NextResponse.json({ ok: true, folder: "", calls: [] });

    // One document, when the page has asked to open it.
    if (wanted) {
      const markdown = await readCall(folder, wanted);
      return NextResponse.json({ ok: true, path: wanted, markdown });
    }

    return NextResponse.json({ ok: true, folder, calls: await listCalls(folder) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Weekly calls did not load." },
      { status: 502 },
    );
  }
}
