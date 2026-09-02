// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary.

"use client";

import { usePathname } from "next/navigation";

/** Tab names that are their own routes — a first path segment of one of these is NOT a client slug. */
const TABS = new Set(["inbox", "database", "campaigns", "analytics", "meetings", "messaging", "calls"]);
const NON_CLIENT = new Set(["login", "admin", "clients", "settings"]);

/**
 * The client slug for the current view, read from the clean path: `/{slug}` and `/{slug}/{tab}`.
 *
 * Path-only, deliberately — `useSearchParams` opts a component into dynamic rendering and stalls client-side
 * navigation (the transition stays pending, so a tab switch takes two clicks). Every client URL is path-based
 * now (the `[client]` route segments), so the path is the whole answer.
 */
export function useClientSlug(): string | null {
  const pathname = usePathname();
  const first = pathname.split("/").filter(Boolean)[0];
  return first && !TABS.has(first) && !NON_CLIENT.has(first) ? first : null;
}
