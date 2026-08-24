// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * Attaching a messaging document to a campaign by hand.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────────────────────
 * The automatic join reads the campaign code, then falls back to comparing the significant words. Both
 * fail on a document whose name shares nothing with the campaign it was written for, and several
 * genuinely do — "Core ICP | New Prospects" is not going to resemble "SW021_ ACO Leaders" no matter how
 * the comparison is written. Rather than tune the matcher until it starts inventing links, a person
 * says which one it is and that answer wins from then on.
 *
 * ── Why clearing is stored rather than deleted ──────────────────────────────────────────────────
 * Setting a document to no campaign writes a row with a null campaign, it does not remove the row.
 * Deleting would return the document to the matcher, which would re-suggest the same link that was just
 * rejected — so "somebody looked at this and it belongs to nothing" has to be a fact the table can hold.
 *
 * ── Why staff only ──────────────────────────────────────────────────────────────────────────────
 * Attribution decides which numbers appear beside which copy. A client changing that is a client
 * editing their own reporting, so the role is checked here before anything is written, and the
 * workspace is resolved through the scoped read rather than taken from the request.
 */
import { NextResponse } from "next/server";
import { currentSession, resolveScope } from "../../../lib/auth-context";
import { adminWrite, scopedRows, str } from "../../../lib/db";

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (session.role !== "staff") {
    return NextResponse.json({ ok: false, error: "Only QC staff can change campaign attribution." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const docPath = str(body.docPath);
  // Absent and null are different: null is a deliberate "no campaign", absent is a malformed request.
  const campaignId = body.campaignId === null ? null : str(body.campaignId);
  if (!docPath) return NextResponse.json({ ok: false, error: "Which document?" }, { status: 400 });

  const { session: scoped, workspaceId } = await resolveScope(str(body.client) || null);
  if (!workspaceId) return NextResponse.json({ ok: false, error: "Pick a client first." }, { status: 400 });

  // The campaign has to belong to this workspace. Without this check a staff session could file one
  // client's campaign against another client's document and the portal would render it as fact.
  if (campaignId) {
    const owned = await scopedRows(
      scoped,
      "rr_campaign_stats",
      { select: "campaign_id", campaign_id: `eq.${campaignId}`, limit: "1" },
      workspaceId,
    );
    if (!owned.length) {
      return NextResponse.json({ ok: false, error: "That campaign does not belong to this client." }, { status: 400 });
    }
  }

  const result = await adminWrite(
    "qc_portal_messaging_links",
    "POST",
    // The user id, not an email: the signed claims deliberately do not carry one, and looking it up
    // just to stamp an audit column would be a database round trip to duplicate what the id already says.
    { workspace_id: workspaceId, doc_path: docPath, campaign_id: campaignId, set_by: session.userId, set_at: new Date().toISOString() },
    { on_conflict: "workspace_id,doc_path" },
    ["resolution=merge-duplicates"],
  );
  if (!result.ok) {
    // PostgREST answers 404 for a table it cannot find, which reached the screen as "The database
    // returned 404." — true, unhelpful, and indistinguishable from a bug. Name the actual cause.
    const missing = /404|does not exist|schema cache/i.test(result.error);
    return NextResponse.json(
      {
        ok: false,
        error: missing
          ? "The attribution table has not been created yet. Run the qc_portal_messaging_links migration in Supabase, then try again."
          : result.error,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, docPath, campaignId });
}
