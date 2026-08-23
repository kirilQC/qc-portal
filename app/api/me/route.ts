// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * Who the browser is, so the shell can greet them and show the right navigation.
 *
 * The session cookie carries the user id and role, but not the name or the client's branding, and it
 * deliberately does not: a cookie is issued once and would go stale the moment somebody is renamed or
 * a client changes their logo. Those are read fresh here.
 *
 * The user row is re-checked on every call rather than trusted from the cookie, which is what makes
 * switching an account off take effect immediately instead of at the end of a fourteen-day session.
 */
import { NextResponse } from "next/server";
import { currentSession, resolveScope } from "../../lib/auth-context";
import { getUser } from "../../lib/users";
import { getClient } from "../../lib/portal-data";

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const user = await getUser(session.userId);
  if (!user || !user.isActive) {
    return NextResponse.json({ ok: false, error: "That account is no longer active." }, { status: 401 });
  }

  /**
   * Which client the shell should wear.
   *
   * For a client session this is their own, always, and `?client=` is ignored — `resolveScope` sees to
   * that. For staff it is whichever client they have opened, so the sidebar can show that client's logo
   * and name rather than a slug. Resolved through the same scoped path as every other read, so this
   * endpoint cannot become a way to look up a workspace the session has no claim on.
   */
  const slug = new URL(request.url).searchParams.get("client");
  const { workspaceId } = await resolveScope(slug).catch(() => ({ workspaceId: session.workspaceId }));
  const client = workspaceId ? await getClient(session, workspaceId).catch(() => null) : null;

  return NextResponse.json({
    ok: true,
    user: { name: user.name, email: user.email, role: user.role },
    client,
  });
}
