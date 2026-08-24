// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * Managing logins. Staff only, enforced here as well as in the middleware.
 *
 * The middleware already turns away a client session at `/api/admin/*`, and this checks again. That is
 * not redundancy for its own sake: the matcher is a regular expression and one edit away from a hole,
 * and the cost of the second check is a cookie read. The rule is that a route which grants access to
 * every client's data never relies on something outside itself to protect it.
 */
import { NextResponse } from "next/server";
import { currentSession } from "../../../lib/auth-context";
import { createUser, deleteUser, listUsers, setActive, setPassword } from "../../../lib/users";
import { listClients } from "../../../lib/portal-data";

export const maxDuration = 30;

async function staffOnly() {
  const session = await currentSession();
  if (!session || session.role !== "staff") return null;
  return session;
}

export async function GET() {
  const session = await staffOnly();
  if (!session) return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
  const [users, clients] = await Promise.all([listUsers(), listClients(session)]);
  // The caller's own id, so the screen can strip the switch-off and delete controls from their own row.
  return NextResponse.json({ ok: true, users, clients, meId: session.userId });
}

export async function POST(request: Request) {
  if (!(await staffOnly())) return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await createUser({
    email: body.email,
    password: body.password,
    role: body.role,
    workspaceId: body.workspaceId,
    name: body.name,
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, user: result.user });
}

export async function PATCH(request: Request) {
  const session = await staffOnly();
  if (!session) return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ ok: false, error: "Which login?" }, { status: 400 });

  // Switching off your own login logs you out with no way back in — the same footgun as deleting it,
  // and blocked the same way. The UI also hides the control, but a hidden control is not a rule.
  if (body.isActive === false && id === session.userId) {
    return NextResponse.json({ ok: false, error: "You cannot switch off the login you are signed in with." }, { status: 400 });
  }

  if (typeof body.password === "string") {
    const result = await setPassword(id, body.password);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  if (typeof body.isActive === "boolean") {
    const result = await setActive(id, body.isActive);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await staffOnly();
  if (!session) return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ ok: false, error: "Which login?" }, { status: 400 });
  // Deleting your own account would lock the last person out of the admin screen.
  if (id === session.userId) {
    return NextResponse.json({ ok: false, error: "You cannot delete the login you are signed in with." }, { status: 400 });
  }
  const result = await deleteUser(id);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
