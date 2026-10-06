// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * The client's Project tracker: QC Command's project board, read-only and curated.
 *
 * ── What a client sees, and what they never do ──────────────────────────────────────────────────
 * QC Command's board is an internal tool. Tasks are auto-created from internal Slack and call analysis,
 * and the notes, blockers, updates feed and attachments are written for the team. So only tasks staff
 * have marked "Show to client" (rr_projects.client_visible) come back, and only the columns named in
 * SAFE_COLUMNS. `context`, `links`, `blocker`, `source`, `updated_by` are never selected, so they cannot
 * leak through a rendering mistake on the page.
 *
 * Staff see exactly what the client sees, plus a `setup` hint when the column has not been created yet.
 */
import { NextResponse } from "next/server";
import { currentSession, resolveScope } from "../../lib/auth-context";
import { scopedRows, str } from "../../lib/db";

const SAFE_COLUMNS = "id,title,stage,owner,priority,week,due_date,position,created_at,updated_at";

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const slug = new URL(request.url).searchParams.get("client");

  try {
    const { session: scoped, workspaceId } = await resolveScope(slug);
    if (!workspaceId) return NextResponse.json({ ok: false, error: "Pick a client first." }, { status: 400 });

    const rows = await scopedRows(
      scoped,
      "rr_projects",
      { select: SAFE_COLUMNS, client_visible: "eq.true", order: "position.asc,created_at.asc", limit: "500" },
      workspaceId,
    );
    const tasks = rows.map((row) => ({
      id: str(row.id),
      title: str(row.title),
      stage: str(row.stage) || "todo",
      owner: row.owner ? str(row.owner) : null,
      priority: row.priority ? str(row.priority) : null,
      startDate: row.week ? str(row.week) : null,
      dueDate: row.due_date ? str(row.due_date) : null,
      updatedAt: row.updated_at ? str(row.updated_at) : null,
    }));
    return NextResponse.json({ ok: true, tasks, isStaff: session.role === "staff" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    // Before the client_visible column exists, the board is simply empty for a client; staff are told why.
    if (/client_visible|rr_projects/i.test(message)) {
      return NextResponse.json({
        ok: true,
        tasks: [],
        isStaff: session.role === "staff",
        setup: session.role === "staff" ? "Run the rr_projects client_visible SQL in Supabase to start sharing tasks." : undefined,
      });
    }
    return NextResponse.json({ ok: false, error: "The project tracker did not load. Try again in a moment." }, { status: 500 });
  }
}
