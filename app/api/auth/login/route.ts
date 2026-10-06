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

/**
 * Failed-attempt throttle, per email and per IP: after too many misses in the window, refuse without
 * checking the password. Best-effort — it lives in one function instance's memory, so it slows online
 * guessing rather than making it impossible — but it costs nothing and turns thousands of guesses an
 * hour into a handful.
 */
const WINDOW_MS = 15 * 60_000;
const MAX_PER_EMAIL = 8;
const MAX_PER_IP = 30;
const failures = new Map<string, { count: number; since: number }>();

function tooMany(key: string, max: number): boolean {
  const entry = failures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.since > WINDOW_MS) {
    failures.delete(key);
    return false;
  }
  return entry.count >= max;
}

function recordFailure(key: string) {
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.since > WINDOW_MS) failures.set(key, { count: 1, since: Date.now() });
  else entry.count += 1;
  if (failures.size > 10_000) failures.clear();
}

export async function POST(request: Request) {
  if (!sessionConfigured() || !dbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "The portal is not configured yet. Set SESSION_SECRET, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const emailKey = `e:${String(body.email ?? "").trim().toLowerCase()}`;
  const ipKey = `i:${(request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim()}`;
  if (tooMany(emailKey, MAX_PER_EMAIL) || tooMany(ipKey, MAX_PER_IP)) {
    return NextResponse.json(
      { ok: false, error: "Too many sign-in attempts. Wait 15 minutes and try again." },
      { status: 429 },
    );
  }

  let session = null;
  try {
    session = await authenticate(body.email, body.password);
  } catch {
    return NextResponse.json({ ok: false, error: "Sign in is unavailable right now." }, { status: 503 });
  }

  if (!session) {
    recordFailure(emailKey);
    recordFailure(ipKey);
    return NextResponse.json({ ok: false, error: "That email and password do not match." }, { status: 401 });
  }

  failures.delete(emailKey);
  const response = NextResponse.json({ ok: true, role: session.role });
  response.cookies.set(SESSION_COOKIE, await mintSession(session), sessionCookieOptions(request.headers.get("host") ?? ""));
  return response;
}
