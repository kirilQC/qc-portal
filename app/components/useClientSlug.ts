// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary.

"use client";

import { useSearchParams } from "next/navigation";

/** The client slug for the current view, from the `?client=` query. */
export function useClientSlug(): string | null {
  return useSearchParams().get("client");
}
