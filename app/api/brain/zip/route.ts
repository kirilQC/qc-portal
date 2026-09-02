// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * The client's whole brain folder, as one ZIP they can keep.
 *
 * This is the off-boarding promise made concrete: the record we built over the engagement, handed over
 * in a form that outlives their access to the portal. Every file under `clients/<folder>/` is fetched
 * (scoped — nothing outside the folder), packed with `app/lib/zip.ts`, and streamed back as a download.
 *
 * ── The two caps, and why they are logged, not silent ───────────────────────────────────────────
 * A folder of markdown is small, but the brain also holds the occasional large PDF or scrape dump. So
 * a per-file size ceiling and a total-file ceiling keep one giant file from blowing the function's
 * memory — and when either trips, the skipped files are named in a `SKIPPED.txt` inside the archive
 * rather than dropped in silence, because a ZIP that quietly omits a document reads as complete.
 */
import { NextResponse } from "next/server";
import { brainConfigured, brainTree, readClientRaw } from "../../../lib/brain";
import { resolveClientFolder } from "../../../lib/brain-scope";
import { currentSession } from "../../../lib/auth-context";
import { buildZip, type ZipEntry } from "../../../lib/zip";

export const maxDuration = 60;

/** A single file this large is skipped — a scrape dump, not a deliverable. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;
/** No more than this many files, so the archive stays inside the function's memory. */
const MAX_FILES = 400;
/** How many files are fetched from GitHub at once — enough to be quick, few enough to stay polite. */
const CONCURRENCY = 8;

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!brainConfigured()) return NextResponse.json({ ok: false, error: "The QC Brain is not connected." }, { status: 503 });

  const slug = new URL(request.url).searchParams.get("client");

  try {
    const client = await resolveClientFolder(slug);
    if (!client?.folder) return NextResponse.json({ ok: false, error: "No client folder." }, { status: 400 });

    const files = await brainTree(client.folder);
    if (!files.length) return NextResponse.json({ ok: false, error: "There is nothing to download yet." }, { status: 404 });

    const skipped: string[] = [];
    const wanted = files
      .filter((file) => {
        if (file.size > MAX_FILE_BYTES) {
          skipped.push(`${file.name} — ${(file.size / 1024 / 1024).toFixed(1)}MB, too large to include`);
          return false;
        }
        return true;
      })
      .slice(0, MAX_FILES);
    if (files.length > MAX_FILES) {
      for (const file of files.slice(MAX_FILES)) skipped.push(`${file.name} — beyond the ${MAX_FILES}-file limit`);
    }

    // Fetch every file's bytes, capped concurrency. One unreadable file is noted and skipped rather than
    // failing the whole archive.
    const entries: ZipEntry[] = [];
    const queue = [...wanted];
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        try {
          const { bytes } = await readClientRaw(client.folder, next.path);
          entries.push({ name: `${client.folder}/${next.name}`, data: Buffer.from(bytes) });
        } catch {
          skipped.push(`${next.name} — could not be read`);
        }
      }
    });
    await Promise.all(workers);

    if (skipped.length) {
      entries.push({ name: `${client.folder}/SKIPPED.txt`, data: Buffer.from(`Not included in this archive:\n\n${skipped.join("\n")}\n`, "utf8") });
    }
    if (!entries.length) return NextResponse.json({ ok: false, error: "Nothing could be read to download." }, { status: 502 });

    const zip = buildZip(entries);
    const filename = `${client.slug || client.folder}-brain.zip`;
    return new NextResponse(new Uint8Array(zip), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${filename}"`,
        "content-length": String(zip.length),
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "The download could not be built." },
      { status: 502 },
    );
  }
}
