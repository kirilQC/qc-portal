// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * Who is asking, proved cryptographically, on every request.
 *
 * ── Why this is not Reply Radar's auth ───────────────────────────────────────────────────────────
 * Reply Radar has one password and one kind of user, so its session cookie is a constant: an HMAC of
 * a fixed string, identical for everybody who logs in. That is the right shape for a tool where being
 * inside means seeing everything.
 *
 * This is the opposite problem. The whole product is that a client sees their own results and nobody
 * else's, so the session cannot be a yes/no — it has to *carry* who you are, and it has to be
 * impossible to edit. So a session here is a signed statement: a small JSON payload naming the user,
 * their role and (for a client) the one workspace they may read, plus an HMAC over it. Change a single
 * character of the payload — swap your workspace id for another client's — and the signature stops
 * matching and the session is rejected. The claims are readable by the holder, which is fine: there is
 * nothing secret in "you are user 12, a client of workspace 7", and it saves a database round trip on
 * every request.
 *
 * ── Why Web Crypto and not node:crypto ──────────────────────────────────────────────────────────
 * The middleware runs on the Edge runtime, where `node:crypto` does not exist. Web Crypto is available
 * in both the Edge middleware and the Node route handlers, so one implementation serves the gate and
 * the login route alike, and there is exactly one place where a session is minted or checked.
 *
 * ── Expiry is inside the signature ──────────────────────────────────────────────────────────────
 * The cookie's own `maxAge` is a request to the browser, not a rule — a copied cookie value outlives
 * it trivially. So the expiry is a signed claim and is checked server-side on every request. The
 * browser hint and the enforced deadline are set from the same constant so they cannot drift apart.
 */

/** The cookie that carries the session. Prefixed so it never collides with Reply Radar's `rr_auth`. */
export const SESSION_COOKIE = "qcp_session";

/** How long a login lasts. Long enough that a client is not re-typing a password every week. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 14; // 14 days

/** What a user is allowed to be. `staff` sees every client; `client` sees exactly one. */
export type Role = "staff" | "client";

/**
 * The signed claims. Short keys because this rides in a cookie on every request.
 * `u` user id · `r` role · `w` workspace id (null for staff) · `e` expiry (unix seconds) · `v` version
 */
export type SessionClaims = {
  u: string;
  r: Role;
  w: string | null;
  e: number;
  v: number;
};

/** The shape the rest of the app reads. Same facts, spelled out. */
export type Session = {
  userId: string;
  role: Role;
  /** The only workspace this session may read. `null` means staff — every workspace. */
  workspaceId: string | null;
};

/**
 * Bumped when the claim shape changes in a way that must invalidate everything already issued.
 * A session minted under an older version is refused rather than reinterpreted.
 */
const CLAIMS_VERSION = 1;

/**
 * The key everything is signed with.
 *
 * There is no fallback constant here, deliberately. Reply Radar falls back to a public string when it
 * is unconfigured, and pairs that with an `authConfigured()` check so an unconfigured install trusts
 * nobody. The same rule is enforced here more bluntly: with no secret set, signing throws and no
 * session can be minted or verified, so a misconfigured deploy fails shut rather than open.
 */
function signingSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error("SESSION_SECRET is not set, so sessions cannot be signed. Set it in the environment.");
  }
  return secret;
}

/** Whether the app has what it needs to authenticate anyone at all. */
export function sessionConfigured(): boolean {
  return Boolean(process.env.SESSION_SECRET?.trim());
}

const encoder = new TextEncoder();

/** base64url — the cookie-safe alphabet, no padding. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const toHex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(signingSecret()), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
}

async function sign(payload: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(), encoder.encode(payload));
  return toHex(signature);
}

/**
 * Constant-time string comparison.
 *
 * Comparing signatures with `===` leaks, through timing, how many leading characters were right, which
 * is enough to forge one character at a time. This always walks the whole string.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

/** Mints the cookie value for a user. */
export async function mintSession(session: Session, now = Date.now()): Promise<string> {
  const claims: SessionClaims = {
    u: session.userId,
    r: session.role,
    w: session.role === "staff" ? null : session.workspaceId,
    e: Math.floor(now / 1000) + SESSION_MAX_AGE,
    v: CLAIMS_VERSION,
  };
  const payload = toBase64Url(encoder.encode(JSON.stringify(claims)));
  return `${payload}.${await sign(payload)}`;
}

/**
 * Reads a cookie back into a session, or returns null.
 *
 * Every failure — malformed, wrong version, bad signature, expired — returns null rather than throwing
 * or distinguishing itself, because the caller's only sane response to any of them is the same: you are
 * not logged in. Order matters: the signature is checked *before* the claims are trusted for anything,
 * including the expiry, since an attacker who could edit claims would simply set the expiry to never.
 */
export async function readSession(cookie: string | undefined | null, now = Date.now()): Promise<Session | null> {
  if (!cookie || !sessionConfigured()) return null;
  const dot = cookie.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = cookie.slice(0, dot);
  const signature = cookie.slice(dot + 1);

  let expected: string;
  try {
    expected = await sign(payload);
  } catch {
    return null;
  }
  if (!timingSafeEqual(signature, expected)) return null;

  let claims: SessionClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as SessionClaims;
  } catch {
    return null;
  }
  if (claims.v !== CLAIMS_VERSION) return null;
  if (typeof claims.e !== "number" || claims.e * 1000 <= now) return null;
  if (claims.r !== "staff" && claims.r !== "client") return null;
  if (typeof claims.u !== "string" || !claims.u) return null;
  // A client session with no workspace can read nothing and must never be treated as unscoped.
  if (claims.r === "client" && (typeof claims.w !== "string" || !claims.w)) return null;

  return { userId: claims.u, role: claims.r, workspaceId: claims.r === "staff" ? null : claims.w };
}

/**
 * The cookie's domain, so one login covers the portal on every host it is served from.
 * Returns undefined — a host-only cookie — unless configured, which is the safe default for previews.
 */
export function cookieDomain(host: string): string | undefined {
  const configured = process.env.PORTAL_COOKIE_DOMAIN?.trim();
  if (configured) return configured;
  const bare = (host ?? "").split(":")[0].toLowerCase();
  const root = process.env.PORTAL_ROOT_DOMAIN?.trim().toLowerCase();
  if (root && (bare === root || bare.endsWith(`.${root}`))) return `.${root}`;
  return undefined;
}

/** The options every place that sets this cookie must use, so they cannot drift apart. */
export function sessionCookieOptions(host: string) {
  const domain = cookieDomain(host);
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE,
    ...(domain ? { domain } : {}),
  };
}
