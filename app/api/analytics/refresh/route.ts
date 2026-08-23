// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * "Sync now" — queues a fresh read of HeyReach for one client.
 *
 * ── Staff only, unlike the rest of this page ────────────────────────────────────────────────────
 * Everything else in the portal reads. This writes: it puts a row in `rr_sync_runs` for the Render
 * worker to claim. That is work and it costs HeyReach API calls, so it is not something a client
 * should be able to trigger repeatedly from a button — they see when the figures were last collected,
 * which is the part that matters to them, and QC presses the button.
 *
 * ── Idempotent by design ────────────────────────────────────────────────────────────────────────
 * A queued or running job for this client means the answer is already on its way, so a second press
 * reports that rather than queueing a duplicate. Two people opening the page and both pressing it is
 * the normal case, not an edge one.
 */
import { NextResponse } from "next/server";
import { currentSession, resolveScope } from "../../../lib/auth-context";
import { adminWrite, scopedRows, str } from "../../../lib/db";

export const maxDuration = 30;

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ ok: false, status: "no_session" }, { status: 401 });
  if (session.role !== "staff") {
    return NextResponse.json({ ok: false, status: "not_allowed", error: "Only QC can trigger a sync." }, { status: 403 });
  }

  const slug = new URL(request.url).searchParams.get("client");
  const { workspaceId } = await resolveScope(slug);
  if (!workspaceId) return NextResponse.json({ ok: false, status: "no_client" }, { status: 400 });

  try {
    const inFlight = await scopedRows(
      session,
      "rr_sync_runs",
      { select: "status,started_at", run_type: "eq.analytics", order: "started_at.desc", limit: "4" },
      workspaceId,
    );
    const already = inFlight.find((row) => ["queued", "running"].includes(str(row.status).toLowerCase()));
    if (already) {
      return NextResponse.json({ ok: true, status: "already_queued", state: str(already.status).toLowerCase() });
    }

    const result = await adminWrite("rr_sync_runs", "POST", {
      workspace_id: workspaceId,
      run_type: "analytics",
      source: "qc-portal-manual",
      status: "queued",
      started_at: new Date().toISOString(),
      records_seen: 0,
      records_written: 0,
    });
    if (!result.ok) return NextResponse.json({ ok: false, status: "error", error: result.error }, { status: 502 });

    return NextResponse.json({ ok: true, status: "queued", state: "queued" });
  } catch (error) {
    return NextResponse.json(
      { ok: false, status: "error", error: error instanceof Error ? error.message : "That sync could not be queued." },
      { status: 502 },
    );
  }
}
