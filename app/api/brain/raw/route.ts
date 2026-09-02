// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * Raw bytes for the things in a client's folder that are not markdown — an image, a PDF.
 *
 * The repo is private, so an `<img src>` in the browser has no token and would 404; this route is the
 * proxy that carries the token server-side. Scoped and path-checked: the file must be inside this
 * session's client folder, and nothing else is reachable.
 */
import { NextResponse } from "next/server";
import { brainConfigured, readClientRaw } from "../../../lib/brain";
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
    const { bytes, type } = await readClientRaw(client.folder, path);
    return new NextResponse(bytes, {
      headers: { "content-type": type, "cache-control": "private, max-age=300" },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "That file could not be read." },
      { status: 502 },
    );
  }
}
