// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * The people who may log in, and what each of them is allowed to see.
 *
 * One table, `qc_portal_users`, and one rule enforced in three places at once: a client user is bound
 * to exactly one workspace. The database has a CHECK constraint saying so, this module refuses to
 * create a row that violates it, and the session layer refuses to mint a session for a client with no
 * workspace. Three independent guards on the one fact the whole product depends on.
 */
import { adminRows, adminWrite, str } from "./db";
import { hashPassword, passwordProblem, verifyPassword } from "./password";
import type { Role, Session } from "./session";

export type PortalUser = {
  id: string;
  email: string;
  role: Role;
  workspaceId: string | null;
  name: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  /** Filled in for the staff user list, so a row can say "Willow" rather than a uuid. */
  workspaceName?: string;
  workspaceSlug?: string;
};

const COLUMNS = "id,email,role,workspace_id,name,is_active,last_login_at,created_at";

function toUser(row: Record<string, unknown>): PortalUser {
  const role: Role = str(row.role) === "staff" ? "staff" : "client";
  return {
    id: str(row.id),
    email: str(row.email),
    role,
    workspaceId: row.workspace_id ? str(row.workspace_id) : null,
    name: str(row.name),
    isActive: row.is_active !== false,
    lastLoginAt: row.last_login_at ? str(row.last_login_at) : null,
    createdAt: str(row.created_at),
  };
}

/** Emails are compared lowercased and trimmed, so "Kiril@" and "kiril@ " are the same account. */
export const normalizeEmail = (email: unknown): string => str(email).trim().toLowerCase();

/**
 * Checks an email and password and returns the session it earns, or null.
 *
 * ── Why every failure looks identical ───────────────────────────────────────────────────────────
 * No-such-user, wrong-password and account-disabled all return null, and the route above turns all
 * three into the same message and the same delay. Distinguishing them would let anyone enumerate which
 * email addresses have accounts, which for a portal whose users are named companies is a real
 * disclosure.
 *
 * ── Why a hash is verified even when the user does not exist ────────────────────────────────────
 * Returning early on an unknown email makes that case measurably faster than a wrong password, which
 * re-introduces the enumeration this is trying to prevent. So a dummy verification runs instead, and
 * both paths cost the same ~200ms of PBKDF2.
 */
export async function authenticate(email: unknown, password: unknown): Promise<Session | null> {
  const address = normalizeEmail(email);
  const secret = typeof password === "string" ? password : "";
  const rows = await adminRows("qc_portal_users", {
    select: `${COLUMNS},password_hash`,
    email: `eq.${address}`,
    limit: "1",
  });
  const row = rows[0];

  if (!row) {
    // Spend the same time as a real check would, then fail. The hash is a valid-format decoy.
    await verifyPassword(secret, "pbkdf2$210000$00000000000000000000000000000000$" + "0".repeat(64));
    return null;
  }

  const ok = await verifyPassword(secret, str(row.password_hash));
  if (!ok) return null;

  const user = toUser(row);
  if (!user.isActive) return null;
  // Belt and braces over the database constraint: never mint an unscoped client session.
  if (user.role === "client" && !user.workspaceId) return null;

  // Best-effort — a failed timestamp write must never cost somebody their login.
  void adminWrite("qc_portal_users", "PATCH", { last_login_at: new Date().toISOString() }, { id: `eq.${user.id}` }).catch(
    () => {},
  );

  return { userId: user.id, role: user.role, workspaceId: user.workspaceId };
}

/** One user by id — used to confirm a session's user still exists and is still active. */
export async function getUser(id: string): Promise<PortalUser | null> {
  if (!id) return null;
  const rows = await adminRows("qc_portal_users", { select: COLUMNS, id: `eq.${id}`, limit: "1" });
  return rows[0] ? toUser(rows[0]) : null;
}

/** Every login, newest first, with the client each one belongs to named. For the staff admin screen. */
export async function listUsers(): Promise<PortalUser[]> {
  const [rows, workspaces] = await Promise.all([
    adminRows("qc_portal_users", { select: COLUMNS, order: "created_at.desc" }),
    adminRows("rr_workspaces", { select: "id,name,slug" }),
  ]);
  const byId = new Map(workspaces.map((row) => [str(row.id), { name: str(row.name), slug: str(row.slug) }]));
  return rows.map((row) => {
    const user = toUser(row);
    const workspace = user.workspaceId ? byId.get(user.workspaceId) : undefined;
    return { ...user, workspaceName: workspace?.name ?? "", workspaceSlug: workspace?.slug ?? "" };
  });
}

/** Creates a login. Returns the user, or the reason it could not be created. */
export async function createUser(input: {
  email: unknown;
  password: unknown;
  role: unknown;
  workspaceId: unknown;
  name: unknown;
}): Promise<{ ok: true; user: PortalUser } | { ok: false; error: string }> {
  const email = normalizeEmail(input.email);
  if (!email || !email.includes("@")) return { ok: false, error: "That is not an email address." };

  const role: Role = str(input.role) === "staff" ? "staff" : "client";
  const workspaceId = role === "staff" ? null : str(input.workspaceId).trim();
  if (role === "client" && !workspaceId) {
    return { ok: false, error: "Pick the client this login belongs to." };
  }

  const password = typeof input.password === "string" ? input.password : "";
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };

  const existing = await adminRows("qc_portal_users", { select: "id", email: `eq.${email}`, limit: "1" });
  if (existing.length) return { ok: false, error: "There is already a login for that email." };

  const result = await adminWrite("qc_portal_users", "POST", {
    email,
    password_hash: await hashPassword(password),
    role,
    workspace_id: workspaceId,
    name: str(input.name).trim(),
  });
  if (!result.ok) return { ok: false, error: result.error };
  const row = result.rows[0];
  if (!row) return { ok: false, error: "The login was not created." };
  return { ok: true, user: toUser(row) };
}

/** Sets a new password on an existing login. */
export async function setPassword(id: string, password: unknown): Promise<{ ok: boolean; error: string }> {
  const secret = typeof password === "string" ? password : "";
  const problem = passwordProblem(secret);
  if (problem) return { ok: false, error: problem };
  const result = await adminWrite(
    "qc_portal_users",
    "PATCH",
    { password_hash: await hashPassword(secret), updated_at: new Date().toISOString() },
    { id: `eq.${id}` },
  );
  return { ok: result.ok, error: result.error };
}

/** Switches a login on or off without destroying it. */
export async function setActive(id: string, isActive: boolean): Promise<{ ok: boolean; error: string }> {
  const result = await adminWrite(
    "qc_portal_users",
    "PATCH",
    { is_active: isActive, updated_at: new Date().toISOString() },
    { id: `eq.${id}` },
  );
  return { ok: result.ok, error: result.error };
}

/** Removes a login entirely. */
export async function deleteUser(id: string): Promise<{ ok: boolean; error: string }> {
  const result = await adminWrite("qc_portal_users", "DELETE", null, { id: `eq.${id}` });
  return { ok: result.ok, error: result.error };
}

/** Whether any account exists at all — the app renders a setup notice instead of a login when none do. */
export async function anyUsersExist(): Promise<boolean> {
  const rows = await adminRows("qc_portal_users", { select: "id", limit: "1" });
  return rows.length > 0;
}
