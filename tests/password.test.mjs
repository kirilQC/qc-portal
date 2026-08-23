// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * The password format, asserted from both ends.
 *
 * The CLI that mints the first hash uses node:crypto; the app that verifies it uses Web Crypto. They
 * are two implementations of one algorithm, and the thing worth testing is that a hash produced by one
 * is accepted by the other — because the failure mode is a first staff account that can never log in.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { pbkdf2Sync, randomBytes, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";

const ITERATIONS = 210_000;
const KEY_LENGTH = 32;

/** The node:crypto side — exactly what scripts/hash-password.mjs does. */
function hashWithNode(password) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, "sha256");
  return `pbkdf2$${ITERATIONS}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** The Web Crypto side — exactly what app/lib/password.ts does when verifying. */
async function verifyWithWebCrypto(password, stored) {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  const fromHex = (hex) => {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return bytes;
  };
  const key = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, [
    "deriveBits",
  ]);
  const bits = await webcrypto.subtle.deriveBits(
    { name: "PBKDF2", salt: fromHex(parts[2]), iterations, hash: "SHA-256" },
    key,
    KEY_LENGTH * 8,
  );
  const actual = new Uint8Array(bits);
  const expected = fromHex(parts[3]);
  if (actual.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < actual.length; i += 1) mismatch |= actual[i] ^ expected[i];
  return mismatch === 0;
}

test("a hash minted by the CLI verifies in the app", async () => {
  const stored = hashWithNode("a-real-password-1234");
  assert.equal(await verifyWithWebCrypto("a-real-password-1234", stored), true);
});

test("the wrong password does not verify", async () => {
  const stored = hashWithNode("a-real-password-1234");
  assert.equal(await verifyWithWebCrypto("a-real-password-1235", stored), false);
});

test("the same password twice produces different hashes", () => {
  // If it did not, the salt would not be doing its job and one rainbow table would crack every account.
  assert.notEqual(hashWithNode("same-password-here"), hashWithNode("same-password-here"));
});

test("a malformed stored hash is refused rather than throwing", async () => {
  for (const bad of ["", "nonsense", "pbkdf2$210000$onlythree", "bcrypt$1$2$3"]) {
    assert.equal(await verifyWithWebCrypto("anything", bad), false);
  }
});

test("the CLI and the app agree on the cost parameters", () => {
  const cli = readFileSync(new URL("../scripts/hash-password.mjs", import.meta.url), "utf8");
  const app = readFileSync(new URL("../app/lib/password.ts", import.meta.url), "utf8");
  for (const source of [cli, app]) {
    assert.ok(source.includes("210_000"), "the iteration count changed in only one place");
    assert.ok(source.includes("KEY_LENGTH = 32"), "the key length changed in only one place");
  }
});
