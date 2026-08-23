// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * Exchanging an email and password for a session cookie.
 *
 * Every failure returns the same message and takes about the same time, so this endpoint cannot be used
 * to discover which email addresses have accounts. The one exception is a genuinely unconfigured
 * install, which says so plainly — that message is for whoever is deploying it, and there is no account
 * to protect yet.
 */
import { NextResponse } from "next/server";
import { authenticate } from "../../../lib/users";
import { SESSION_COOKIE, mintSession, sessionConfigured, sessionCookieOptions } from "../../../lib/session";
import { dbConfigured } from "../../../lib/db";

/** PBKDF2 is deliberately slow, and a cold start adds to it. Well clear of the default ten seconds. */
export const maxDuration = 30;

export async function POST(request: Request) {
  if (!sessionConfigured() || !dbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "The portal is not configured yet. Set SESSION_SECRET, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  let session = null;
  try {
    session = await authenticate(body.email, body.password);
  } catch {
    return NextResponse.json({ ok: false, error: "Sign in is unavailable right now." }, { status: 503 });
  }

  if (!session) {
    return NextResponse.json({ ok: false, error: "That email and password do not match." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true, role: session.role });
  response.cookies.set(SESSION_COOKIE, await mintSession(session), sessionCookieOptions(request.headers.get("host") ?? ""));
  return response;
}
