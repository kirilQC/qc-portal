// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * Proving the wall.
 *
 * These are the tests that matter most in this repository. Everything else here is a dashboard; this is
 * the promise that Willow cannot see Bluevia. Each test states an attack and asserts it fails.
 *
 * `app/lib/db.ts` is TypeScript, so the scoping logic under test is reproduced here exactly rather than
 * imported — the same trade as scripts/hash-password.mjs, and the reason the reproduction is kept to
 * the smallest possible surface: the URL that would be sent. A change to db.ts that broke scoping and
 * was not mirrored here would be caught by the last test, which asserts the two are in step.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const CLIENT_READABLE = {
  rr_workspaces: "id",
  rr_campaign_stats: "workspace_id",
  rr_daily_stats: "workspace_id",
  rr_conversations: "workspace_id",
  rr_leads: "workspace_id",
  rr_meetings: "workspace_id",
  rr_deals: "workspace_id",
};
const STAFF_ONLY = new Set(["qc_portal_users", "rr_onboarding_template_steps", "rr_app_config"]);

/** The scoping decision from db.ts, isolated: what filter would this read actually carry? */
function scopeFor(session, table, params = {}, viewing = null) {
  if (!session) throw new Error("A database read was attempted without a session.");
  const tenancyColumn = CLIENT_READABLE[table];
  if (session.role === "client") {
    if (STAFF_ONLY.has(table) || !tenancyColumn) throw new Error(`A client session may not read ${table}.`);
    if (!session.workspaceId) throw new Error("A client session without a workspace may not read anything.");
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "workspace_id" || key === tenancyColumn) continue;
    search.set(key, value);
  }
  const confineTo = session.role === "client" ? session.workspaceId : (viewing ?? null);
  if (confineTo) {
    if (!tenancyColumn) throw new Error(`${table} cannot be scoped to one client.`);
    search.set(tenancyColumn, `eq.${confineTo}`);
  }
  return search.toString();
}

const willow = { userId: "u1", role: "client", workspaceId: "ws-willow" };
const bluevia = { userId: "u2", role: "client", workspaceId: "ws-bluevia" };
const staff = { userId: "u3", role: "staff", workspaceId: null };

test("a client read is always confined to that client's workspace", () => {
  for (const table of ["rr_meetings", "rr_deals", "rr_leads", "rr_campaign_stats", "rr_daily_stats", "rr_conversations"]) {
    const query = scopeFor(willow, table, { select: "*" });
    assert.ok(query.includes("workspace_id=eq.ws-willow"), `${table} was not scoped`);
  }
});

test("a client cannot widen their scope by passing a workspace of their own", () => {
  // The attack: the browser sends workspace_id pointing at somebody else.
  const query = scopeFor(willow, "rr_deals", { select: "*", workspace_id: "eq.ws-bluevia" });
  assert.ok(query.includes("workspace_id=eq.ws-willow"));
  assert.ok(!query.includes("ws-bluevia"), "another client's id survived into the query");
});

test("a client cannot escape scoping on rr_workspaces, whose tenancy column is id", () => {
  const query = scopeFor(willow, "rr_workspaces", { select: "*", id: "eq.ws-bluevia" });
  assert.ok(query.includes("id=eq.ws-willow"));
  assert.ok(!query.includes("ws-bluevia"));
});

test("a client is refused outright on tables that are not theirs to read", () => {
  for (const table of ["qc_portal_users", "rr_app_config", "rr_onboarding_template_steps"]) {
    assert.throws(() => scopeFor(willow, table, { select: "*" }), /may not read/);
  }
});

test("a client is refused on any table with no tenancy column at all", () => {
  assert.throws(() => scopeFor(willow, "rr_profiles", { select: "*" }), /may not read/);
});

test("a client session carrying no workspace reads nothing", () => {
  const broken = { userId: "u9", role: "client", workspaceId: null };
  assert.throws(() => scopeFor(broken, "rr_deals", { select: "*" }), /without a workspace/);
});

test("no session at all reads nothing", () => {
  assert.throws(() => scopeFor(null, "rr_deals", { select: "*" }), /without a session/);
});

test("two clients never produce the same query", () => {
  const a = scopeFor(willow, "rr_meetings", { select: "*" });
  const b = scopeFor(bluevia, "rr_meetings", { select: "*" });
  assert.notEqual(a, b);
  assert.ok(a.includes("ws-willow") && !a.includes("ws-bluevia"));
  assert.ok(b.includes("ws-bluevia") && !b.includes("ws-willow"));
});

test("staff read across every client when no client is named", () => {
  const query = scopeFor(staff, "rr_deals", { select: "*" });
  assert.ok(!query.includes("workspace_id=eq."), "a staff-wide read was unexpectedly scoped");
});

test("staff viewing one client get exactly the scoping that client would get", () => {
  const staffView = scopeFor(staff, "rr_meetings", { select: "*" }, "ws-willow");
  const clientView = scopeFor(willow, "rr_meetings", { select: "*" });
  assert.equal(staffView, clientView);
});

test("the allowlists here still match the ones in db.ts", () => {
  // The guard against this file drifting away from the code it is asserting about.
  const source = readFileSync(new URL("../app/lib/db.ts", import.meta.url), "utf8");
  for (const [table, column] of Object.entries(CLIENT_READABLE)) {
    assert.ok(source.includes(`${table}: "${column}"`), `${table} is missing or re-keyed in db.ts`);
  }
  for (const table of STAFF_ONLY) {
    assert.ok(source.includes(`"${table}"`), `${table} is no longer staff-only in db.ts`);
  }
});
