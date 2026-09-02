// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * The raw markdown of one document in the client's own folder.
 *
 * The Brain tab reads laid-out documents through `/api/brain/render`; this is the plain-text companion,
 * for "show me the original" and for anything the layout step declines to touch. Scoped and path-checked
 * like everything else here — the document must live inside this session's client folder.
 */
import { NextResponse } from "next/server";
import { brainConfigured, readClientDoc } from "../../../lib/brain";
import { resolveClientFolder } from "../../../lib/brain-scope";
import { currentSession } from "../../../lib/auth-context";

export const maxDuration = 30;

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!brainConfigured()) return NextResponse.json({ ok: false, error: "The QC Brain is not connected." }, { status: 503 });

  const url = new URL(request.url);
  const path = url.searchParams.get("path")?.trim() ?? "";
  const slug = url.searchParams.get("client");
  if (!path) return NextResponse.json({ ok: false, error: "No file was asked for." }, { status: 400 });

  try {
    const client = await resolveClientFolder(slug);
    if (!client?.folder) return NextResponse.json({ ok: false, error: "No client folder." }, { status: 400 });
    const doc = await readClientDoc(client.folder, path);
    return NextResponse.json({ ok: true, path, markdown: doc.text });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "That document could not be opened." },
      { status: 502 },
    );
  }
}
