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
import { currentSession } from "../../lib/auth-context";
import { getUser } from "../../lib/users";
import { getClient } from "../../lib/portal-data";

export async function GET() {
  const session = await currentSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const user = await getUser(session.userId);
  if (!user || !user.isActive) {
    return NextResponse.json({ ok: false, error: "That account is no longer active." }, { status: 401 });
  }

  const client = session.workspaceId ? await getClient(session, session.workspaceId) : null;

  return NextResponse.json({
    ok: true,
    user: { name: user.name, email: user.email, role: user.role },
    client,
  });
}
