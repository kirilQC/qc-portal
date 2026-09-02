// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * The readable layout of one brain document, for the client's own folder.
 *
 * The brain's documents are plain prose written in a text editor; this hands one to a model that lays
 * it out again — headings, a row of figures, a table where the prose was already a table — so the
 * client opening it sees what is in it at a glance. The layout is Reply Radar's; the file is GitHub's;
 * nothing here writes to the brain.
 *
 * ── Three ways it can answer, cheapest first ────────────────────────────────────────────────────
 * 1. A layout for this exact version already sits in the shared cache (Reply Radar warms most of them):
 *    return it, no model call, no spend.
 * 2. Not cached and this app has an Anthropic key: lay it out now, cache it for next time, return it.
 * 3. Not cached and no key: return the raw markdown, which the reader still renders — just not
 *    restructured. The page is never left blank because a layout could not be made.
 *
 * The cache is keyed on the file's git SHA, so an edit in GitHub invalidates it exactly.
 */
import { NextResponse } from "next/server";
import { brainConfigured, readClientDoc } from "../../../lib/brain";
import { resolveClientFolder } from "../../../lib/brain-scope";
import { currentSession } from "../../../lib/auth-context";
import { cachedRender, renderBrainDoc } from "../../../lib/brain-render";
import { fileKind } from "../../../../shared/brain-structure.mjs";

export const maxDuration = 60;

type Row = Record<string, unknown>;

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Row;
  const path = typeof body.path === "string" ? body.path.trim() : "";
  const force = body.force === true;
  const slug = typeof body.client === "string" ? body.client : null;

  if (!path) return NextResponse.json({ ok: false, error: "No file was asked for." }, { status: 400 });
  if (fileKind(path) !== "doc") return NextResponse.json({ ok: false, error: "Only documents can be laid out." }, { status: 400 });
  if (!brainConfigured()) return NextResponse.json({ ok: false, error: "The QC Brain is not connected." }, { status: 503 });

  try {
    const client = await resolveClientFolder(slug);
    if (!client?.folder) return NextResponse.json({ ok: false, error: "No client folder." }, { status: 400 });

    // Read from the brain (scoped and path-checked) rather than trusting text posted from the browser —
    // a cache keyed by a SHA the server did not verify is a cache of somebody else's text.
    const doc = await readClientDoc(client.folder, path);

    if (!force) {
      const cached = await cachedRender(path, doc.sha).catch(() => null);
      if (cached) return NextResponse.json({ ok: true, render: cached, raw: doc.text });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      // No key here: the reader still gets the document, just not the laid-out version.
      return NextResponse.json({ ok: true, render: null, raw: doc.text });
    }

    try {
      const render = await renderBrainDoc({ path, text: doc.text, sha: doc.sha, force });
      return NextResponse.json({ ok: true, render, raw: doc.text });
    } catch {
      // A layout failure is not a page failure — hand back the raw document.
      return NextResponse.json({ ok: true, render: null, raw: doc.text });
    }
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "That document could not be opened." },
      { status: 502 },
    );
  }
}
