// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * A person changing their own name, email or password — and inviting a colleague.
 *
 * ── Why changing your own password needs the old one ────────────────────────────────────────────
 * A session cookie is fourteen days long. If a laptop is left open, or a cookie copied, the holder
 * could otherwise change the password and lock out the actual owner. Requiring the current password
 * means possession of the session alone is not enough to take the account over, which is the whole
 * point of asking.
 *
 * ── Why a client can invite, and what that invitation can be ────────────────────────────────────
 * The people who should have access to a client's results are known to that client, not to QC, so
 * making QC the bottleneck on adding a colleague is a support ticket for no security gain. But an
 * invitation is strictly *sideways*: the new login is created with the inviter's own role and their own
 * workspace, both taken from the signed session and never from the request. A client therefore cannot
 * invent a staff account, and cannot invite somebody into a different client's data — the two things
 * that would matter.
 */
import { NextResponse } from "next/server";
import { currentSession } from "../../lib/auth-context";
import { adminRows, adminWrite, str } from "../../lib/db";
import { hashPassword, passwordProblem, verifyPassword } from "../../lib/password";
import { createUser, getUser, listUsers, normalizeEmail } from "../../lib/users";

export const maxDuration = 30;

/** Everyone who shares this account's workspace — a client's own team, and nobody else's. */
export async function GET() {
  const session = await currentSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const user = await getUser(session.userId);
  if (!user) return NextResponse.json({ ok: false, error: "That account no longer exists." }, { status: 401 });

  // Staff have the admin screen for this; a client sees only the logins on their own workspace.
  const colleagues =
    session.role === "staff"
      ? []
      : (await listUsers())
          .filter((other) => other.workspaceId === session.workspaceId)
          .map((other) => ({ id: other.id, name: other.name, email: other.email, isActive: other.isActive }));

  return NextResponse.json({
    ok: true,
    account: { name: user.name, email: user.email, role: user.role },
    colleagues,
  });
}

/** Changing your own details. */
export async function PATCH(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const rows = await adminRows("qc_portal_users", {
    select: "id,email,password_hash",
    id: `eq.${session.userId}`,
    limit: "1",
  });
  const row = rows[0];
  if (!row) return NextResponse.json({ ok: false, error: "That account no longer exists." }, { status: 401 });

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.name === "string") update.name = body.name.trim();

  if (typeof body.email === "string" && body.email.trim()) {
    const email = normalizeEmail(body.email);
    if (!email.includes("@")) return NextResponse.json({ ok: false, error: "That is not an email address." }, { status: 400 });
    if (email !== str(row.email)) {
      const taken = await adminRows("qc_portal_users", { select: "id", email: `eq.${email}`, limit: "1" });
      if (taken.length) return NextResponse.json({ ok: false, error: "There is already a login for that email." }, { status: 400 });
      update.email = email;
    }
  }

  if (typeof body.newPassword === "string" && body.newPassword) {
    const problem = passwordProblem(body.newPassword);
    if (problem) return NextResponse.json({ ok: false, error: problem }, { status: 400 });
    // Possession of the session is not enough to take the account over. See the note above.
    const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
    if (!(await verifyPassword(current, str(row.password_hash)))) {
      return NextResponse.json({ ok: false, error: "That current password is not right." }, { status: 403 });
    }
    update.password_hash = await hashPassword(body.newPassword);
  }

  const result = await adminWrite("qc_portal_users", "PATCH", update, { id: `eq.${session.userId}` });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/** Inviting a colleague onto the same workspace, with the same role. */
export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await createUser({
    email: body.email,
    password: body.password,
    name: body.name,
    // Both taken from the session, never from the request — an invitation cannot escalate a role or
    // reach into another client's workspace.
    role: session.role,
    workspaceId: session.workspaceId,
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, user: { id: result.user.id, email: result.user.email } });
}
