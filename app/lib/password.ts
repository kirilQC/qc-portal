// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * Storing passwords so that a copy of the database is not a copy of everyone's password.
 *
 * ── Why PBKDF2 and not a plain hash ─────────────────────────────────────────────────────────────
 * A password put through SHA-256 once is not protected: a commodity GPU tries billions of candidates a
 * second, so every password in a leaked table that is not genuinely random falls within hours. The
 * defence is to make each guess expensive, which is what a key-derivation function is for. PBKDF2 with
 * a high iteration count turns one guess into 210,000 hashes, which is imperceptible when a person logs
 * in once and ruinous when an attacker wants to try a dictionary.
 *
 * bcrypt/scrypt/argon2 are better still, but every one of them is a dependency with native bindings,
 * and this app is deliberately dependency-free — PBKDF2-SHA256 is in Web Crypto, works identically in
 * Node and Edge, and at this iteration count is what OWASP recommends when it is what you have.
 *
 * ── Why the salt is per-password ────────────────────────────────────────────────────────────────
 * A shared salt lets one precomputed table crack every account at once, and makes two users with the
 * same password visibly identical in the table. Sixteen random bytes per password removes both.
 *
 * ── The stored format ───────────────────────────────────────────────────────────────────────────
 * `pbkdf2$&lt;iterations&gt;$&lt;salt-hex&gt;$&lt;hash-hex&gt;` — self-describing, so the iteration count can be raised
 * later without invalidating existing passwords: an old hash still verifies against its own recorded
 * cost, and can be re-hashed at the next successful login.
 */

const ITERATIONS = 210_000;
const KEY_LENGTH = 32; // bytes
const SALT_LENGTH = 16; // bytes
const SCHEME = "pbkdf2";

const encoder = new TextEncoder();

const toHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

function fromHex(hex: string): Uint8Array {
  const clean = hex.trim();
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), { name: "PBKDF2" }, false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations, hash: "SHA-256" },
    key,
    KEY_LENGTH * 8,
  );
  return new Uint8Array(bits);
}

/** Turns a plaintext password into the string that goes in the database. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const hash = await derive(password, salt, ITERATIONS);
  return `${SCHEME}$${ITERATIONS}$${toHex(salt)}$${toHex(hash)}`;
}

/**
 * Checks a password against a stored hash.
 *
 * Comparison is constant-time for the same reason session signatures are: a byte-at-a-time early exit
 * is measurable over a network and turns a guessing problem into a much smaller one. A malformed or
 * empty stored hash returns false rather than throwing — a user row with no usable password simply
 * cannot log in, which is the correct outcome for a disabled or half-created account.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!password || !stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== SCHEME) return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 1_000) return false;
  let expected: Uint8Array;
  let actual: Uint8Array;
  try {
    expected = fromHex(parts[3]);
    actual = await derive(password, fromHex(parts[2]), iterations);
  } catch {
    return false;
  }
  if (expected.length !== actual.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) mismatch |= expected[i] ^ actual[i];
  return mismatch === 0;
}

/**
 * What is wrong with a proposed password, or "" if nothing is.
 *
 * Length is the only rule that reliably matters, so it is the only one enforced. Composition rules
 * ("one capital, one symbol") push people toward `Password1!` and a sticky note; a twelve-character
 * minimum does more for the same friction. The upper bound exists because PBKDF2 will happily spend
 * real CPU on a megabyte of input, which is a denial-of-service waiting to happen.
 */
export function passwordProblem(password: string): string {
  if (typeof password !== "string" || !password) return "Choose a password.";
  if (password.length < 12) return "Use at least 12 characters.";
  if (password.length > 200) return "That password is too long.";
  return "";
}
