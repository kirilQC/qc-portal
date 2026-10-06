// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * A client's inbox tags: their own labels, applied to conversations.
 *
 * Each client has its own list (qc_portal_tags), managed by the client and by QC staff viewing that
 * client. QC Command's tags are a separate, internal vocabulary and are never read here.
 *
 * ── Every write is scoped twice ─────────────────────────────────────────────────────────────────
 * The workspace comes from the session (resolveScope), never the body. And before a tag is linked to a
 * conversation, both are read back through scopedRows — so a client cannot tag another client's
 * conversation, or use another client's tag, by guessing an id.
 */
import { NextResponse } from "next/server";
import { resolveScope } from "../../../lib/auth-context";
import { adminWrite, scopedRows, str } from "../../../lib/db";

/** The colours a tag can take — the same set QC Command offers, so tags look alike in both. */
const TAG_COLORS = ["#5b8cff", "#2fbf7f", "#e0a83d", "#e5484d", "#c05bd9", "#3fb0c9", "#f07a3a", "#8b93a7"];
const MISSING = "Tags aren't set up yet. Run the qc_portal_tags block of supabase/portal-schema.sql in Supabase.";

type Body = Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const failure = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
const explain = (message: string) => (/does not exist|schema cache|PGRST205/i.test(message) ? MISSING : message);

async function scope(slug: string | null) {
  const { session, workspaceId } = await resolveScope(slug);
  return workspaceId ? { session, workspaceId } : null;
}

export async function GET(request: Request) {
  try {
    const scoped = await scope(new URL(request.url).searchParams.get("client"));
    if (!scoped) return failure("Pick a client first.");
    const [tags, links] = await Promise.all([
      scopedRows(scoped.session, "qc_portal_tags", { select: "id,name,color", order: "name.asc", limit: "200" }, scoped.workspaceId),
      scopedRows(scoped.session, "qc_portal_tag_assignments", { select: "conversation_id,tag_id", limit: "5000" }, scoped.workspaceId),
    ]);
    const assignments: Record<string, string[]> = {};
    for (const row of links) (assignments[str(row.conversation_id)] ??= []).push(str(row.tag_id));
    return NextResponse.json({
      ok: true,
      colors: TAG_COLORS,
      tags: tags.map((row) => ({ id: str(row.id), name: str(row.name), color: str(row.color) })),
      assignments,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, tags: [], assignments: {}, error: explain(error instanceof Error ? error.message : "") }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const action = text(body.action);
  try {
    const scoped = await scope(text(body.client) || null);
    if (!scoped) return failure("Pick a client first.");
    const { session, workspaceId } = scoped;
    const ownTag = async (id: string) =>
      id ? (await scopedRows(session, "qc_portal_tags", { select: "id", id: `eq.${id}`, limit: "1" }, workspaceId)).length > 0 : false;

    if (action === "create" || action === "update") {
      const name = text(body.name).slice(0, 40);
      const color = TAG_COLORS.includes(text(body.color)) ? text(body.color) : TAG_COLORS[0];
      if (action === "create") {
        if (!name) return failure("Give the tag a name.");
        const result = await adminWrite("qc_portal_tags", "POST", { workspace_id: workspaceId, name, color });
        if (!result.ok) return failure(/duplicate|unique/i.test(result.error) ? "A tag with that name already exists." : explain(result.error), 409);
        const row = result.rows[0] ?? {};
        return NextResponse.json({ ok: true, tag: { id: str(row.id), name, color } });
      }
      const id = text(body.id);
      if (!(await ownTag(id))) return failure("That tag doesn't exist.", 404);
      const patch: Body = {};
      if (name) patch.name = name;
      if (body.color !== undefined) patch.color = color;
      const result = await adminWrite("qc_portal_tags", "PATCH", patch, { id: `eq.${id}`, workspace_id: `eq.${workspaceId}` });
      if (!result.ok) return failure(/duplicate|unique/i.test(result.error) ? "A tag with that name already exists." : explain(result.error), 409);
      return NextResponse.json({ ok: true });
    }

    if (action === "delete") {
      const id = text(body.id);
      if (!(await ownTag(id))) return failure("That tag doesn't exist.", 404);
      const result = await adminWrite("qc_portal_tags", "DELETE", null, { id: `eq.${id}`, workspace_id: `eq.${workspaceId}` });
      return result.ok ? NextResponse.json({ ok: true }) : failure(explain(result.error), 502);
    }

    if (action === "assign" || action === "unassign") {
      const conversationId = text(body.conversationId), tagId = text(body.tagId);
      if (!conversationId || !tagId) return failure("A conversation and a tag are both required.");
      const [conversation, tagIsOwn] = await Promise.all([
        scopedRows(session, "rr_conversations", { select: "id", id: `eq.${conversationId}`, limit: "1" }, workspaceId),
        ownTag(tagId),
      ]);
      if (!conversation.length || !tagIsOwn) return failure("That conversation or tag isn't in this inbox.", 404);
      const result = action === "assign"
        ? await adminWrite("qc_portal_tag_assignments", "POST", { workspace_id: workspaceId, conversation_id: conversationId, tag_id: tagId }, { on_conflict: "conversation_id,tag_id" }, ["resolution=merge-duplicates"])
        : await adminWrite("qc_portal_tag_assignments", "DELETE", null, { conversation_id: `eq.${conversationId}`, tag_id: `eq.${tagId}`, workspace_id: `eq.${workspaceId}` });
      return result.ok ? NextResponse.json({ ok: true }) : failure(explain(result.error), 502);
    }

    return failure("Unknown action.");
  } catch (error) {
    return failure(explain(error instanceof Error ? error.message : "The tag change could not be saved."), 502);
  }
}
