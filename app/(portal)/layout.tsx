// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

import Shell from "../components/Shell";

/**
 * The frame, mounted once for every signed-in page.
 *
 * ── Why this is a layout and not a wrapper inside each page ─────────────────────────────────────
 * It used to be the latter, and it flickered: moving between tabs unmounted the whole shell and built
 * it again, so the sidebar re-fetched who you were and showed QC's mark for the moment before the
 * answer came back — a client watching their own portal saw somebody else's branding flash on every
 * click. A layout is preserved across navigations within its segment, so the sidebar is mounted once
 * per session, keeps its state, and never asks the question twice.
 *
 * The login screen sits outside this group deliberately: it is the one page with no shell to keep.
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>;
}
