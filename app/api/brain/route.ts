// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * One client's whole QC Brain folder, as a page they can read.
 *
 * ── What it answers ─────────────────────────────────────────────────────────────────────────────
 * Not "what files are here" — that would be the GitHub file tree with nicer fonts. It answers "what do
 * we know about this client, and where is it", shaped as the fixed skeleton every client folder is some
 * approximation of (Brief, ICP, Personas, Voice, Engagement, Pipeline, Do-not-contact) with everything
 * else grouped underneath. A missing skeleton document is shown as missing, which a file listing cannot
 * do.
 *
 * ── Scope ───────────────────────────────────────────────────────────────────────────────────────
 * The folder comes from the session, never from the URL. A client sees their own folder and only their
 * own; there is no parameter that widens that. Read-only throughout — nothing in this route or the ones
 * beside it writes to the brain.
 */
import { NextResponse } from "next/server";
import { brainClientActivity, brainConfigured, brainTree, readClientDoc } from "../../lib/brain";
import { resolveClientFolder } from "../../lib/brain-scope";
import { currentSession } from "../../lib/auth-context";
import {
  briefSummary,
  clientSkeleton,
  coverage,
  fileKind,
  fileTitle,
} from "../../../shared/brain-structure.mjs";

export const maxDuration = 30;

type Skeleton = {
  client: string;
  label: string;
  docs: { key: string; label: string; blurb: string; found: string; present: boolean }[];
  extras: string[];
  groups: { folder: string; files: { path: string; name: string }[] }[];
};

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  if (!brainConfigured()) {
    return NextResponse.json(
      { ok: false, reason: "not_connected", error: "The QC Brain is not connected. Set BRAIN_GITHUB_TOKEN in the environment." },
      { status: 503 },
    );
  }

  const slug = new URL(request.url).searchParams.get("client");

  try {
    const client = await resolveClientFolder(slug);
    if (!client?.folder) {
      return NextResponse.json({ ok: false, reason: "no_client_folder", error: "This client has no QC Brain folder linked." });
    }

    const files = await brainTree(client.folder);
    if (!files.length) {
      return NextResponse.json({ ok: false, reason: "empty", error: `There is nothing under clients/${client.folder} in the brain yet.` });
    }
    const paths = files.map((file) => file.path);
    const skeleton = clientSkeleton(client.folder, paths) as Skeleton;

    // The brief's opening paragraph, so the hero can say who this client is up top — one extra read.
    const briefPath = skeleton.docs.find((doc) => doc.key === "brief" && doc.present)?.found ?? "";
    const [brief, activity] = await Promise.all([
      briefPath ? readClientDoc(client.folder, briefPath).catch(() => null) : Promise.resolve(null),
      brainClientActivity(client.folder).catch(() => ({ latestItem: "", latestDate: "", since: "" })),
    ]);
    const { summary, facts } = briefSummary(brief?.text ?? "") as { summary: string; facts: { label: string; value: string }[] };

    return NextResponse.json({
      ok: true,
      client: {
        folder: client.folder,
        label: client.name || skeleton.label,
        logo: client.logo,
        summary,
        facts,
        activity,
        fileCount: files.length,
        coverage: coverage(skeleton),
        docs: skeleton.docs.map((doc) => ({
          key: doc.key,
          label: doc.label,
          blurb: doc.blurb,
          path: doc.found,
          present: doc.present,
        })),
        groups: skeleton.groups
          .map((group) => ({
            folder: group.folder,
            // Drop any stray do-not-contact file: it is already its own "Do not contact" card above, and
            // listing it again under a folder is a confusing duplicate.
            files: group.files
              .filter((file) => {
                const base = file.name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z]/g, "");
                return base !== "dnc" && base !== "donotcontact";
              })
              .map((file) => ({ path: file.path, name: file.name, title: fileTitle(file.path), kind: fileKind(file.path) })),
          }))
          // A folder that held only that file is now empty — don't show an empty folder card.
          .filter((group) => group.files.length > 0),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, reason: "error", error: error instanceof Error ? error.message : "The QC Brain could not be read." },
      { status: 502 },
    );
  }
}
