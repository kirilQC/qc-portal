// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * Makes the hash for the first staff account, which has to exist before anybody can log in and create
 * the others. Chicken-and-egg, solved once at the command line:
 *
 *   npm run hash-password -- 'the password you chose'
 *
 * Then paste the printed hash into the insert at the bottom of supabase/portal-schema.sql. The
 * plaintext never leaves your terminal and is never stored.
 *
 * The algorithm is duplicated from app/lib/password.ts rather than imported, because that file is
 * TypeScript and this must run under plain node with no build step. The parameters are the constants
 * that matter and they are asserted against each other by tests/password.test.mjs, so the two cannot
 * drift apart unnoticed.
 */
import { pbkdf2Sync, randomBytes } from "node:crypto";

const ITERATIONS = 210_000;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

const password = process.argv[2];
if (!password) {
  console.error("Usage: npm run hash-password -- 'your password'");
  process.exit(1);
}
if (password.length < 12) {
  console.error("Use at least 12 characters.");
  process.exit(1);
}

const salt = randomBytes(SALT_LENGTH);
const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, "sha256");
console.log(`pbkdf2$${ITERATIONS}$${salt.toString("hex")}$${hash.toString("hex")}`);
