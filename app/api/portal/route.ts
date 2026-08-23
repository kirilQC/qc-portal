// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * Everything one client's dashboard needs, in one request.
 *
 * ── Why one endpoint rather than five ───────────────────────────────────────────────────────────
 * The pages here are views of the same small set of facts, and five round trips to render one screen
 * is five chances to show a half-loaded dashboard. The reads run concurrently server-side and arrive
 * together, so the page either has its data or is honestly still loading.
 *
 * ── Where the client comes from ─────────────────────────────────────────────────────────────────
 * `?client=` is honoured only for staff. For a client session the workspace comes from the signed
 * cookie and the parameter is ignored entirely — see `resolveScope`. There is no code path in this
 * route that can read a workspace the session did not earn.
 */
import { NextResponse } from "next/server";
import { resolveScope } from "../../lib/auth-context";
import {
  getCampaigns,
  getClient,
  getDaily,
  getDeals,
  getMeetings,
  getOverview,
  getReplies,
  listClients,
} from "../../lib/portal-data";

export const maxDuration = 30;

export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("client");

  let scope;
  try {
    scope = await resolveScope(slug);
  } catch {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }
  const { session, workspaceId } = scope;

  // Staff with no client named: the directory, not a dashboard.
  if (!workspaceId) {
    const clients = await listClients(session);
    return NextResponse.json({ ok: true, view: "directory", clients });
  }

  const [client, overview, campaigns, daily, meetings, deals, replies] = await Promise.all([
    getClient(session, workspaceId),
    getOverview(session, workspaceId),
    getCampaigns(session, workspaceId),
    getDaily(session, workspaceId),
    getMeetings(session, workspaceId),
    getDeals(session, workspaceId),
    getReplies(session, workspaceId),
  ]);

  if (!client) return NextResponse.json({ ok: false, error: "That client was not found." }, { status: 404 });

  return NextResponse.json({
    ok: true,
    view: "client",
    role: session.role,
    client,
    overview,
    campaigns,
    daily,
    meetings,
    deals,
    replies,
  });
}
