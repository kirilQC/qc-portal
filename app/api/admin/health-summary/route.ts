// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * The cheap read behind the sidebar's health dot.
 *
 * The full health page is several database reads; polling that from every page for every staff member
 * would be wasteful. So this returns only the *cached* verdict the watchdog cron last wrote to
 * `qc_portal_health_state` — one row — which is exactly what the nav dot needs: is anything red right
 * now. It also means the dot and the Slack alert always agree, because they read the same stored verdict.
 *
 * Empty until the cron has run at least once, which fails safe: no dot rather than a false all-clear.
 */
import { NextResponse } from "next/server";
import { currentSession } from "../../../lib/auth-context";
import { adminRows } from "../../../lib/db";

export async function GET() {
  const session = await currentSession();
  // Client sessions have no business knowing the fleet's health; the dot is a staff affordance.
  if (!session || session.role !== "staff") {
    return NextResponse.json({ ok: true, level: null });
  }
  try {
    const rows = await adminRows("qc_portal_health_state", { select: "last_verdict,updated_at", id: "eq.singleton", limit: "1" }).catch(() => []);
    const verdict = (rows[0]?.last_verdict ?? null) as { level?: string; headline?: string } | null;
    return NextResponse.json({
      ok: true,
      level: verdict?.level ?? null,
      headline: verdict?.headline ?? null,
      updatedAt: rows[0]?.updated_at ?? null,
    });
  } catch {
    return NextResponse.json({ ok: true, level: null });
  }
}
