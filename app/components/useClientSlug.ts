// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary.

"use client";

import { usePathname, useSearchParams } from "next/navigation";

/** Tab names that are their own routes — a first path segment of one of these is NOT a client slug. */
const TABS = new Set(["inbox", "database", "campaigns", "analytics", "meetings", "messaging", "calls"]);
const NON_CLIENT = new Set(["login", "admin", "clients", "settings"]);

/**
 * The client slug for the current view.
 *
 * Read from the clean path (`/{slug}` and `/{slug}/{tab}`) FIRST, because the middleware rewrite that maps
 * those paths to the real pages injects `?client=` into the *internal* request only — the browser URL has
 * no query, so `useSearchParams` cannot see it. The visible path is the source of truth. Falls back to the
 * legacy `?client=` query so old links (`/messaging?client=cotool`) still resolve.
 */
export function useClientSlug(): string | null {
  const pathname = usePathname();
  const params = useSearchParams();
  const first = pathname.split("/").filter(Boolean)[0];
  if (first && !TABS.has(first) && !NON_CLIENT.has(first)) return first;
  return params.get("client");
}
