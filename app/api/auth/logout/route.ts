// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * Signing out: the cookie is overwritten with an empty value and a zero lifetime.
 *
 * The same options the cookie was set with are reused, because a cookie is identified by name *and*
 * domain and path — clearing it with different options leaves the original in place and the user
 * mysteriously still signed in.
 */
import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "../../../lib/session";

export async function POST(request: Request) {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(request.headers.get("host") ?? ""), maxAge: 0 });
  return response;
}
