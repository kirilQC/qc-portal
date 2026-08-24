// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * The documents one client has in the QC Brain — weekly calls, and campaign messaging.
 *
 * ── One route for both, because they are the same read ──────────────────────────────────────────
 * Two folders, two tabs, and otherwise identical: find the folder, list its markdown, hand back one
 * document when asked for it. Duplicating that into two routes would mean the path check exists twice
 * and could come to differ, which is exactly the check that must not.
 *
 * ── Three distinct outcomes, said differently ───────────────────────────────────────────────────
 * "The brain is not connected", "this client has no such folder" and "the folder is there but empty"
 * are three different situations with three different fixes, and collapsing them into one empty state
 * sends whoever is reading it looking in the wrong place.
 */
import { NextResponse } from "next/server";
import { currentSession, resolveScope } from "../../lib/auth-context";
import { scopedRows, str } from "../../lib/db";
import { READABLE_FOLDERS, brainConfigured, findFolder, listDocs, readDoc, type FolderKey } from "../../lib/brain";

export const maxDuration = 30;

/**
 * Everything up to the `## Transcript` heading.
 *
 * Cutting the text off before it is serialised is the whole point: a client session never receives the
 * transcript, so there is nothing in the payload for a curious reader to find.
 */
function withoutTranscript(markdown: string): string {
  const match = markdown.match(/^##\s+Transcript\s*$/im);
  return match?.index === undefined ? markdown : markdown.slice(0, match.index).replace(/\s+$/, "");
}

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const url = new URL(request.url);
  const key = url.searchParams.get("folder") as FolderKey | null;
  if (!key || !(key in READABLE_FOLDERS)) {
    return NextResponse.json({ ok: false, error: "That is not a readable folder." }, { status: 400 });
  }

  if (!brainConfigured()) {
    return NextResponse.json(
      { ok: false, reason: "not_connected", error: "The QC Brain is not connected. Set BRAIN_GITHUB_TOKEN in the environment." },
      { status: 503 },
    );
  }

  const slug = url.searchParams.get("client");
  const wanted = url.searchParams.get("path");

  try {
    const { session: scoped, workspaceId } = await resolveScope(slug);
    if (!workspaceId) return NextResponse.json({ ok: false, error: "Pick a client first." }, { status: 400 });

    const rows = await scopedRows(scoped, "rr_workspaces", { select: "brain_folder,slug,name", limit: "1" }, workspaceId);
    const row = rows[0];
    // Falls back to the slug, which is what the brain folder is named for most clients.
    const clientFolder = str(row?.brain_folder) || str(row?.slug);
    const label = READABLE_FOLDERS[key].label;

    if (!clientFolder) {
      return NextResponse.json({ ok: false, reason: "no_client_folder", error: `${str(row?.name) || "This client"} has no QC Brain folder linked.` });
    }

    const subfolder = await findFolder(clientFolder, key);
    if (!subfolder) {
      return NextResponse.json({
        ok: false,
        reason: "no_folder",
        error: `No "${label}" folder was found in ${str(row?.name) || "this client"}'s QC Brain folder (clients/${clientFolder}).`,
      });
    }

    /**
     * Whether the viewer may see a weekly call's transcript.
     *
     * The recap is written for the client and they should have it. The transcript is thirty unedited
     * minutes of QC talking, machine-transcribed, and `posted_to: Internal` on these documents says that
     * distinction already matters. So the recap goes to everyone and the transcript is staff-only — and
     * it is enforced here rather than hidden in the component, because a hidden div is not a permission.
     */
    const staff = scoped.role === "staff";

    if (wanted) {
      const markdown = await readDoc(clientFolder, subfolder, wanted);
      return NextResponse.json({ ok: true, path: wanted, markdown: staff ? markdown : withoutTranscript(markdown), staff });
    }

    return NextResponse.json({ ok: true, folder: subfolder, label, staff, docs: await listDocs(clientFolder, subfolder) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, reason: "error", error: error instanceof Error ? error.message : "That did not load." },
      { status: 502 },
    );
  }
}
