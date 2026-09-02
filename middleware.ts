// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * The front door. Nothing is reachable without a valid session except the login itself.
 *
 * ── Deny by default ─────────────────────────────────────────────────────────────────────────────
 * The list below is of what is *open*, not what is closed. A new page or API route added tomorrow is
 * protected the moment it exists, because it is not on the list — the opposite arrangement, where a
 * route is public until somebody remembers to protect it, is how pages leak.
 *
 * ── Why the session is verified here and not only in routes ─────────────────────────────────────
 * The signature check is cheap (one HMAC) and runs before any route code, so an expired or forged
 * cookie never reaches a handler that might trust it. Routes still re-read the session for the claims
 * they need — the gate answers "is this anybody", the route answers "is this the right somebody".
 *
 * ── Staff-only areas ────────────────────────────────────────────────────────────────────────────
 * `/admin` manages logins, so a client session reaching it is turned away here rather than relying on
 * the page to hide its own buttons. A hidden button is not a permission.
 */
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readSession } from "./app/lib/session";

/** Reachable without being logged in: the login screen and the endpoints that serve it. */
function isOpenPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/logout" ||
    pathname === "/api/health" ||
    // The health watchdog carries no session — it is a cron on a timer. It gates itself on CRON_SECRET
    // instead (see the route), so the middleware lets it reach that check rather than bouncing it to login.
    pathname === "/api/cron/health-alert"
  );
}

/** Reachable only by QC's own team. */
function isStaffPath(pathname: string): boolean {
  return pathname.startsWith("/admin") || pathname.startsWith("/api/admin/");
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isOpenPath(pathname)) return NextResponse.next();

  const session = await readSession(request.cookies.get(SESSION_COOKIE)?.value);

  if (!session) {
    // An API answers a machine, which wants a status code, not a redirect to an HTML page.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    // Send them back where they were going, but only if it is a path on this site — an absolute or
    // protocol-relative "next" is an open redirect, and a login page is exactly where those get used.
    const next = pathname + request.nextUrl.search;
    if (next && next !== "/" && next.startsWith("/") && !next.startsWith("//")) {
      url.searchParams.set("next", next);
    }
    return NextResponse.redirect(url);
  }

  if (isStaffPath(pathname) && session.role !== "staff") {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|favicon.svg|robots.txt|.*\\.(?:png|jpe?g|gif|svg|webp|ico|css|js|map|woff2?|ttf)).*)",
  ],
};
