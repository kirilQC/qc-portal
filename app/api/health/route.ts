// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * Is this deployment able to work at all?
 *
 * Reachable without signing in, because its whole purpose is to answer "why can nobody sign in" — a
 * question that by definition cannot be asked from behind the login. It is therefore written to say
 * nothing an attacker could use: whether each variable is *present*, never its value, and whether the
 * users table answers, never what is in it.
 *
 * The length of a secret is reported because a variable pasted with a trailing newline or a truncated
 * key is a real and otherwise invisible failure, and a length alone does not narrow a 32-byte secret.
 */
import { NextResponse } from "next/server";


export const dynamic = "force-dynamic";

export async function GET() {
  const present = (name: string) => {
    const value = process.env[name]?.trim() ?? "";
    return { set: Boolean(value), length: value.length };
  };

  const env = {
    SESSION_SECRET: present("SESSION_SECRET"),
    SUPABASE_URL: present("SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: present("SUPABASE_SERVICE_ROLE_KEY"),
  };

  // Does the URL at least look like a Supabase project URL? A value that is set but is not a URL is
  // the failure this is most likely to be diagnosing.
  const url = process.env.SUPABASE_URL?.trim() ?? "";
  const urlLooksRight = url.startsWith("https://") && url.includes(".supabase.");

  /**
   * A raw fetch rather than `adminRows`, which returns [] for every failure alike. Here the distinction
   * is the entire point: 404/PGRST205 means the table has not been created yet, 401 means the key is
   * wrong, and a thrown error means the URL is not reachable at all.
   */
  let usersTable = "not checked";
  if (env.SUPABASE_URL.set && env.SUPABASE_SERVICE_ROLE_KEY.set) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
    try {
      const response = await fetch(`${url}/rest/v1/qc_portal_users?select=id&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" },
        cache: "no-store",
      });
      if (response.ok) {
        const rows = (await response.json().catch(() => [])) as unknown[];
        usersTable = `reachable — ${Array.isArray(rows) ? rows.length : 0} row(s) visible`;
      } else {
        const body = await response.text().catch(() => "");
        usersTable = `HTTP ${response.status} — ${body.slice(0, 200)}`;
      }
    } catch (error) {
      usersTable = `unreachable: ${error instanceof Error ? error.message : "unknown"}`;
    }
  }

  const ready = env.SESSION_SECRET.set && env.SUPABASE_URL.set && env.SUPABASE_SERVICE_ROLE_KEY.set && urlLooksRight;

  return NextResponse.json({ ok: true, ready, env, urlLooksRight, usersTable });
}
