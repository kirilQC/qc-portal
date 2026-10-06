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
import { adminWrite, scopedRows, str } from "./db";
import { getUser } from "./users";

/**
 * Whether a validly-signed session still belongs to a live login.
 *
 * The signature proves the cookie was issued, not that the login behind it still exists. Sessions are
 * long-lived and nothing server-side can cancel one, so without this a user who was switched off or
 * deleted kept reading their workspace — and could even mint a fresh login through /api/account. So the
 * login is re-read: it must exist, be active, and still have the role and workspace the cookie claims.
 * Cached per user for a short window so a page's burst of requests costs one lookup, not one each; a
 * deactivation therefore takes effect within LIVE_TTL_MS. Fails closed if the lookup itself fails.
 */
const LIVE_TTL_MS = 30_000;
const ACTIVE_EVERY_MS = 10 * 60_000;
const liveCache = new Map<string, { at: number; ok: boolean }>();

async function stillLive(session: Session): Promise<boolean> {
  const key = `${session.userId}|${session.role}|${session.workspaceId ?? ""}`;
  const hit = liveCache.get(key);
  if (hit && Date.now() - hit.at < LIVE_TTL_MS) return hit.ok;
  let ok = false;
  try {
    const user = await getUser(session.userId);
    ok = Boolean(
      user && user.isActive && user.role === session.role &&
      (session.role === "staff" || user.workspaceId === session.workspaceId),
    );
    // "Last active", kept true. Sessions last for weeks, so the timestamp written at password sign-in
    // goes stale while somebody uses the portal every day. Refreshed here at most every ACTIVE_EVERY_MS,
    // riding the lookup this check already makes; a failed write never affects the request.
    if (ok && user && (!user.lastLoginAt || Date.now() - Date.parse(user.lastLoginAt) > ACTIVE_EVERY_MS)) {
      await adminWrite("qc_portal_users", "PATCH", { last_login_at: new Date().toISOString() }, { id: `eq.${user.id}` }).catch(() => {});
    }
  } catch {
    return false;
  }
  if (liveCache.size > 5000) liveCache.clear();
  liveCache.set(key, { at: Date.now(), ok });
  return ok;
}

/** The signed-in session, or null — null too when the login behind a valid cookie is gone or switched off. */
export async function currentSession(): Promise<Session | null> {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  return (await stillLive(session)) ? session : null;
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
