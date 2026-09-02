// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary.

"use client";

import { useParams } from "next/navigation";

/**
 * The client slug for the current view, from the `[client]` route segment (`/{client}`, `/{client}/{tab}`).
 *
 * Read from the route param, NOT `useSearchParams` — the latter opts a component into dynamic rendering and
 * stalls client-side navigation (a tab switch took two clicks). At the staff directory (`/`) there is no
 * `[client]` segment, so this returns null and the overview app shows the directory.
 */
export function useClientSlug(): string | null {
  const params = useParams() as Record<string, string | string[] | undefined>;
  const c = params?.client;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c[0] ?? null;
  return null;
}
