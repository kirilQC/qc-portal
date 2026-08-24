// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * Configuration and heartbeats for every client. Staff only, checked here as well as in the middleware.
 */
import { NextResponse } from "next/server";
import { currentSession } from "../../../lib/auth-context";
import { healthVerdict, listClientOps, systemHealth } from "../../../lib/ops-data";

export const maxDuration = 60;

export async function GET() {
  const session = await currentSession();
  if (!session || session.role !== "staff") {
    return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
  }
  try {
    const [clients, health] = await Promise.all([
      listClientOps(session),
      systemHealth(session),
    ]);
    const verdict = healthVerdict(clients, health.worker);
    return NextResponse.json({ ok: true, clients, health, verdict, checkedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "That did not load." },
      { status: 502 },
    );
  }
}
