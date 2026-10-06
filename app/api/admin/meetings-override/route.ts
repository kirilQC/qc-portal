// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * Setting, or clearing, the "Meetings booked" figure a client sees.
 *
 * The figure is counted from rr_meetings, which misses meetings booked outside QC Command. Staff can say
 * the real number here; `meetingsBooked: null` deletes the override and hands the figure back to the
 * automatic count. Portal-only — QC Command never reads this table.
 *
 * Staff-only twice over: /api/admin/* is refused to client sessions in the middleware, and again here.
 */
import { NextResponse } from "next/server";
import { currentSession, resolveScope } from "../../../lib/auth-context";
import { adminWrite, str } from "../../../lib/db";

const TABLE = "qc_portal_meeting_overrides";
const MISSING = "The meetings override table has not been created yet. Run the qc_portal_meeting_overrides block of supabase/portal-schema.sql in Supabase, then try again.";

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (session.role !== "staff") {
    return NextResponse.json({ ok: false, error: "Only QC staff can change the meetings booked figure." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { workspaceId } = await resolveScope(str(body.client) || null);
  if (!workspaceId) return NextResponse.json({ ok: false, error: "Pick a client first." }, { status: 400 });

  const clearing = body.meetingsBooked === null;
  const value = Number(body.meetingsBooked);
  if (!clearing && (!Number.isInteger(value) || value < 0 || value > 100_000)) {
    return NextResponse.json({ ok: false, error: "Meetings booked must be a whole number, 0 or more." }, { status: 400 });
  }

  const result = clearing
    ? await adminWrite(TABLE, "DELETE", null, { workspace_id: `eq.${workspaceId}` })
    : await adminWrite(
        TABLE,
        "POST",
        { workspace_id: workspaceId, meetings_booked: value, set_by: session.userId, set_at: new Date().toISOString() },
        { on_conflict: "workspace_id" },
        ["resolution=merge-duplicates"],
      );
  if (!result.ok) {
    const missing = /404|does not exist|schema cache|PGRST205/i.test(result.error);
    return NextResponse.json({ ok: false, error: missing ? MISSING : result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, meetingsBooked: clearing ? null : value });
}
