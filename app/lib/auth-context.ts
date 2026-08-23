// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * Reading the current session inside a route handler or a server component.
 *
 * The middleware has already refused anyone without a valid signature, so by the time these run the
 * cookie is known-good. They are still written to fail closed — returning null rather than assuming —
 * because a route that is one day reachable by another path (a rewrite, a direct invocation, a change
 * to the matcher) must not become an open door on that day.
 *
 * {@link resolveScope} is the other half of the tenancy story. A client is confined to their own
 * workspace, full stop. Staff may look at one client by naming it in the URL, and when they do they get
 * exactly the same scoped read a client would — the same functions, the same filter — so what QC sees
 * on a client's page is what the client sees, and the two cannot drift apart.
 */
import { cookies } from "next/headers";
import { SESSION_COOKIE, readSession, type Session } from "./session";
import { scopedRows, str } from "./db";

/** The signed-in session, or null. */
export async function currentSession(): Promise<Session | null> {
  const store = await cookies();
  return readSession(store.get(SESSION_COOKIE)?.value);
}

/** The signed-in session, or a thrown error — for code paths that have no meaning without one. */
export async function requireSession(): Promise<Session> {
  const session = await currentSession();
  if (!session) throw new Error("Not signed in.");
  return session;
}

export type Scope = {
  session: Session;
  /** The workspace being read. Null only for a staff view spanning every client. */
  workspaceId: string | null;
};

/**
 * Works out which client this request is about.
 *
 * `slug` is what a staff user asked to look at, and is ignored entirely for a client session — a client
 * appending `?client=someone-else` gets their own data, not a 403, because there is nothing to explain:
 * their portal has exactly one client in it.
 */
export async function resolveScope(slug?: string | null): Promise<Scope> {
  const session = await requireSession();
  if (session.role === "client") return { session, workspaceId: session.workspaceId };
  if (!slug) return { session, workspaceId: null };
  const rows = await scopedRows(session, "rr_workspaces", { select: "id", slug: `eq.${slug}`, limit: "1" });
  return { session, workspaceId: rows[0] ? str(rows[0].id) : null };
}
