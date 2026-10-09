// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * The Brain tab's "Connect your Claude" section. GET says whether this client has a link (never the link
 * itself, which is shown once); POST makes a new one, which turns any earlier one off; DELETE turns it off.
 * The client comes from the session: a client session manages only its own link, staff the client named.
 */
import { NextResponse } from "next/server";
import { resolveScope } from "../../../lib/auth-context";
import { connectorStatus, issueConnector, revokeConnector } from "../../../lib/brain-connector";

async function scope(request: Request) {
  const slug = new URL(request.url).searchParams.get("client");
  const { session, workspaceId } = await resolveScope(slug);
  if (!workspaceId) throw new Error("Which client?");
  return { session, workspaceId };
}

const origin = (request: Request) => {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") || url.host;
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  return `${proto}://${host}`;
};

export async function GET(request: Request) {
  try {
    const { workspaceId } = await scope(request);
    return NextResponse.json({ ok: true, ...(await connectorStatus(workspaceId)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not read the connection." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const { session, workspaceId } = await scope(request);
    const { token } = await issueConnector(workspaceId, `${session.role}:${session.userId}`);
    return NextResponse.json({ ok: true, url: `${origin(request)}/api/mcp/brain/${token}`, ...(await connectorStatus(workspaceId)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not make the link." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { workspaceId } = await scope(request);
    await revokeConnector(workspaceId);
    return NextResponse.json({ ok: true, ...(await connectorStatus(workspaceId)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not turn it off." }, { status: 400 });
  }
}
