// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

// Staff clients directory (no client) — renders the shared overview app, which shows the directory when
// no client is in scope.
//
// A client session has no directory: it is sent to its own /{slug}. Left at the bare `/`, there is no
// [client] segment for the sidebar to build links from, so its tabs pointed at /inbox, /campaigns —
// which the router then read as a client called "inbox".
import { redirect } from "next/navigation";
import { currentSession } from "../lib/auth-context";
import { getClient } from "../lib/portal-data";
import OverviewApp from "./OverviewApp";

export default async function Page() {
  const session = await currentSession();
  if (session?.role === "client" && session.workspaceId) {
    const client = await getClient(session, session.workspaceId).catch(() => null);
    if (client?.slug) redirect(`/${encodeURIComponent(client.slug)}`);
  }
  return <OverviewApp />;
}
