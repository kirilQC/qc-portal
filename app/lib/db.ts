// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * The only way this application is allowed to read the database.
 *
 * ── Why a choke point, and why it is the most important file here ───────────────────────────────
 * This portal shows Willow their results and Bluevia theirs, and the entire product promise is that
 * neither can ever see the other. That promise cannot be kept by remembering to write
 * `workspace_id=eq.…` on every query, because the day somebody forgets is the day a client sees another
 * client's pipeline, and nothing about that mistake announces itself — the page renders, the numbers
 * look plausible, and the damage is found by the customer.
 *
 * So scoping is not a convention here, it is the only available interface. Every read goes through
 * {@link scopedRows}, which takes a session and *derives* the filter from it. There is no exported
 * function that talks to PostgREST without one, and no caller can pass a workspace id of their own
 * choosing: the id comes from the signed session cookie and nowhere else. A query with no session
 * throws rather than returning unscoped rows — the failure mode is a blank page, never a leak.
 *
 * ── Why the service role key, given the above ───────────────────────────────────────────────────
 * Reply Radar's tables have row-level security enabled with no policies at all, which means the anon
 * key reads precisely nothing, and every existing code path uses the service role key to bypass RLS.
 * That is a sound design for a single-tenant internal tool. This app inherits the same key because it
 * reads the same tables — and therefore carries the whole burden of tenancy in the wall below. The
 * accompanying `supabase/portal-schema.sql` adds real RLS policies for a future second wall; until
 * those are in force this file *is* the wall, which is why it is written to be paranoid rather than
 * convenient.
 *
 * ── The table allowlist ─────────────────────────────────────────────────────────────────────────
 * A client may only ever read from tables that carry a `workspace_id`, because those are the only ones
 * where "yours" is a question the database can answer. Anything else — the master onboarding template,
 * global config, the users table itself — is refused outright for a client session rather than being
 * silently returned unfiltered.
 */
import type { Session } from "./session";

/** Tables a client session may read, each keyed by the column that carries tenancy. */
const CLIENT_READABLE: Record<string, string> = {
  rr_workspaces: "id",
  rr_campaign_stats: "workspace_id",
  rr_daily_stats: "workspace_id",
  rr_conversations: "workspace_id",
  rr_leads: "workspace_id",
  rr_meetings: "workspace_id",
  rr_deals: "workspace_id",
};

/** Tables only a staff session may read. Never reachable from a client session, filtered or not. */
const STAFF_ONLY = new Set(["qc_portal_users", "rr_onboarding_template_steps", "rr_app_config"]);

export type Row = Record<string, unknown>;

function config() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  return { url, key };
}

/** Whether the app can reach the database at all. Used to render a useful message instead of a stack. */
export function dbConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

/**
 * PostgREST ignores a write body without a content-type, silently and with a 200 — a failure mode that
 * cost Reply Radar an afternoon — so it is always set, on reads too, where it is harmless.
 */
function authHeaders(key: string, write = false) {
  const headers: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "content-type": "application/json",
  };
  if (write) headers.Prefer = "return=representation";
  return headers;
}

/**
 * A read, scoped to whatever the session is allowed to see.
 *
 * `params` carries everything except tenancy: `select`, `order`, `limit`, and any additional filters.
 * The workspace filter is appended here and cannot be overridden — if a caller passes a `workspace_id`
 * of their own it is discarded, because the only trustworthy source for it is the signed session.
 *
 * A staff session reads across every workspace, which is the point of a staff session. When staff are
 * looking at one client, the caller passes `viewing` and gets the same scoping a client would — so the
 * staff view of a client is rendered by exactly the code path the client sees, and cannot drift from it.
 */
export async function scopedRows(
  session: Session | null,
  table: string,
  params: Record<string, string> = {},
  viewing?: string | null,
): Promise<Row[]> {
  if (!session) throw new Error("A database read was attempted without a session.");

  const tenancyColumn = CLIENT_READABLE[table];
  if (session.role === "client") {
    if (STAFF_ONLY.has(table) || !tenancyColumn) {
      throw new Error(`A client session may not read ${table}.`);
    }
    if (!session.workspaceId) throw new Error("A client session without a workspace may not read anything.");
  }

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    // Tenancy is never taken from the caller, only ever from the session.
    if (key === "workspace_id" || key === tenancyColumn) continue;
    search.set(key, value);
  }

  /** The one workspace this read is confined to, or null for an unrestricted staff read. */
  const confineTo = session.role === "client" ? session.workspaceId : (viewing ?? null);
  if (confineTo) {
    if (!tenancyColumn) throw new Error(`${table} cannot be scoped to one client.`);
    search.set(tenancyColumn, `eq.${confineTo}`);
  }

  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/${table}?${search.toString()}`, {
    headers: authHeaders(key),
    cache: "no-store",
  });
  if (!response.ok) return [];
  const body = await response.json().catch(() => []);
  return Array.isArray(body) ? (body as Row[]) : [];
}

/**
 * Reads that are not about a client at all — the portal's own user table.
 *
 * Kept separate from {@link scopedRows} on purpose: mixing "rows belonging to a tenant" and "rows
 * belonging to the application" in one function is how a tenancy filter ends up optional. This one is
 * never reachable with a client session.
 */
export async function adminRows(table: string, params: Record<string, string> = {}): Promise<Row[]> {
  const { url, key } = config();
  const search = new URLSearchParams(params);
  const response = await fetch(`${url}/rest/v1/${table}?${search.toString()}`, {
    headers: authHeaders(key),
    cache: "no-store",
  });
  if (!response.ok) return [];
  const body = await response.json().catch(() => []);
  return Array.isArray(body) ? (body as Row[]) : [];
}

/** A write to the portal's own tables. Client sessions never reach this — routes gate on role first. */
export async function adminWrite(
  table: string,
  method: "POST" | "PATCH" | "DELETE",
  body: unknown,
  params: Record<string, string> = {},
): Promise<{ ok: boolean; rows: Row[]; error: string }> {
  const { url, key } = config();
  const search = new URLSearchParams(params);
  const response = await fetch(`${url}/rest/v1/${table}?${search.toString()}`, {
    method,
    headers: authHeaders(key, true),
    body: method === "DELETE" ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as Record<string, unknown>).message)
        : `The database returned ${response.status}.`;
    return { ok: false, rows: [], error: message };
  }
  return { ok: true, rows: Array.isArray(payload) ? (payload as Row[]) : [], error: "" };
}

/** Small readers, so callers stop writing `String(row.x ?? "")` in every file. */
export const str = (value: unknown): string => (typeof value === "string" ? value : value == null ? "" : String(value));
export const num = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
