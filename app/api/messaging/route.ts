// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * A client's campaign messaging, parsed into sequences and joined to the campaigns that ran them.
 *
 * ── Why this reads every document at once ───────────────────────────────────────────────────────
 * The index has to say how many steps each document has and which campaign it belongs to, and both of
 * those are inside the document. So there is no version of this screen that reads one file at a time:
 * the choice is between reading them all here, or reading them all from the browser in a burst of
 * requests. Doing it here means one round trip, an index that is right the moment it appears, and a
 * document that opens with no wait at all — the parsed sequences are already on the client.
 *
 * ── Why a failed document does not fail the page ────────────────────────────────────────────────
 * Each read is settled independently. One unreadable file among fifteen returns as a document with an
 * error on it, and the other fourteen render — losing the whole tab because one file was renamed
 * mid-read would be a poor trade.
 *
 * ── Scoping ─────────────────────────────────────────────────────────────────────────────────────
 * The campaigns come through `scopedRows` like everything else, so the workspace filter is derived from
 * the session rather than from anything the caller sent. The brain folder is likewise resolved from the
 * scoped workspace row, never from a parameter.
 */
import { NextResponse } from "next/server";
import { currentSession, resolveScope } from "../../lib/auth-context";
import { scopedRows, str } from "../../lib/db";
import { getCampaigns } from "../../lib/portal-data";
import { READABLE_FOLDERS, brainConfigured, findFolder, listDocs, readDoc } from "../../lib/brain";
// Plain ESM so the test runner can import the same code the server runs; see shared/messaging.mjs.
import { matchCampaign, parseSequence, splitFrontmatter } from "../../../shared/messaging.mjs";

export const maxDuration = 60;

/** Read no more than this many documents in one page load. */
const MAX_DOCS = 80;
/** Concurrent GitHub reads. Enough to be quick, few enough to stay well inside the rate limit. */
const LANES = 8;

type Parsed = {
  path: string;
  name: string;
  title: string;
  meta: Record<string, string>;
  senders: string[];
  preamble: string;
  steps: unknown[];
  campaign: null | { campaignId: string; name: string; confidence: string; score: number };
  stats: null | Record<string, unknown>;
  error?: string;
};

/** Run `worker` over `items` with a fixed number of lanes, preserving input order. */
async function pooled<T, R>(items: T[], lanes: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(lanes, items.length) }, async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        out[index] = await worker(items[index]);
      }
    }),
  );
  return out;
}

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
    const { session: scoped, workspaceId } = await resolveScope(slug);
    if (!workspaceId) return NextResponse.json({ ok: false, error: "Pick a client first." }, { status: 400 });

    const rows = await scopedRows(scoped, "rr_workspaces", { select: "brain_folder,slug,name", limit: "1" }, workspaceId);
    const row = rows[0];
    const clientFolder = str(row?.brain_folder) || str(row?.slug);
    const clientName = str(row?.name) || "This client";
    const label = READABLE_FOLDERS.messaging.label;

    if (!clientFolder) {
      return NextResponse.json({ ok: false, reason: "no_client_folder", error: `${clientName} has no QC Brain folder linked.` });
    }

    const subfolder = await findFolder(clientFolder, "messaging");
    if (!subfolder) {
      return NextResponse.json({
        ok: false,
        reason: "no_folder",
        error: `No "${label}" folder was found in ${clientName}'s QC Brain folder (clients/${clientFolder}).`,
      });
    }

    // The campaigns are fetched alongside the listing rather than after it: neither depends on the
    // other, and this screen is already waiting on a folder-full of file reads.
    const [listing, campaigns] = await Promise.all([
      listDocs(clientFolder, subfolder),
      getCampaigns(scoped, workspaceId).catch(() => []),
    ]);

    const capped = listing.slice(0, MAX_DOCS);
    const forMatching = campaigns.map((c) => ({ campaignId: c.campaignId, name: c.name }));
    const byId = new Map(campaigns.map((c) => [c.campaignId, c]));

    const docs = await pooled<(typeof capped)[number], Parsed>(capped, LANES, async (doc) => {
      const base = {
        path: doc.path, name: doc.name, title: doc.title,
        meta: {}, senders: [], preamble: "", steps: [], campaign: null, stats: null,
      };
      try {
        const raw = await readDoc(clientFolder, subfolder, doc.path);
        const { meta, body } = splitFrontmatter(raw);
        const parsed = parseSequence(body);
        // The heading inside the document beats the file name: the file is a slug, the heading is what
        // somebody actually typed.
        const title = str(meta.title) || parsed.title || doc.title;
        const campaign = matchCampaign(title, forMatching) ?? matchCampaign(doc.title, forMatching);
        const stats = campaign ? byId.get(campaign.campaignId) ?? null : null;
        return { ...base, title, meta, senders: parsed.senders, preamble: parsed.preamble, steps: parsed.steps, campaign, stats };
      } catch (error) {
        return { ...base, error: error instanceof Error ? error.message : "That document did not load." };
      }
    });

    return NextResponse.json({
      ok: true,
      folder: subfolder,
      label,
      docs,
      // Said out loud rather than silently dropped, so a folder that outgrows the cap is visible.
      truncated: listing.length > capped.length ? listing.length - capped.length : 0,
      campaignsKnown: campaigns.length,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, reason: "error", error: error instanceof Error ? error.message : "That did not load." },
      { status: 502 },
    );
  }
}
