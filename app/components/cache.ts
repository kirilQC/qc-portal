// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * What the last successful fetch of a URL returned, kept for as long as the tab is open.
 *
 * ── The problem this solves ─────────────────────────────────────────────────────────────────────
 * Every tab is its own route, so moving between them unmounts one page and mounts another, and each
 * page began its life with no data and a "Loading…" — including when it was asking for a payload the
 * previous page had already fetched a second earlier. Moving Overview → Campaigns → Overview meant
 * three full round trips and three blank screens for something that had not changed.
 *
 * So a successful response is remembered here and handed straight back the next time anybody asks for
 * the same URL. The request still goes out, and the fresh answer still replaces the cached one — the
 * cache removes the *blank screen*, not the refresh.
 *
 * ── Why a module-level Map and not a context ────────────────────────────────────────────────────
 * The pages are separate routes rather than siblings under one provider, so there is no component that
 * stays mounted across a tab change to hold the state. A module lives as long as the page does, which
 * is exactly the lifetime wanted: it survives navigation and dies on reload, so a hard refresh is
 * always a genuinely clean read.
 *
 * ── Why this is safe to show stale ──────────────────────────────────────────────────────────────
 * Everything cached here is a read of a reporting figure, seconds old at worst and replaced as soon as
 * the request returns. Nothing here is written back, and nothing is cached across a sign-out: the store
 * is per-page-load, so a different session cannot see the previous one's payload.
 */
const STORE = new Map<string, unknown>();

/** Forget everything. Called on sign-out so a second sign-in in the same tab starts clean. */
export function clearCache() {
  STORE.clear();
}

/**
 * Fetch JSON, showing whatever was last seen for this URL while the request is in flight.
 *
 * `fresh` distinguishes "this is what we had" from "this is what the server just said", for a caller
 * that wants to show a quiet refreshing state. `loading` is only true when there is nothing to show at
 * all, which is the first visit and nothing else.
 *
 * @param url  the URL to fetch, or null to fetch nothing and hold whatever state exists
 */
export function useCachedJson<T>(url: string | null): {
  data: T | null; error: string; loading: boolean; fresh: boolean; reload: () => void;
} {
  const key = url ?? "";
  const [data, setData] = useState<T | null>(() => (STORE.get(key) as T) ?? null);
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState(false);
  const [nonce, setNonce] = useState(0);

  /*
   * Adjusting state during render when the URL changes, rather than in an effect.
   *
   * This is the case React documents for it: the component needs different state for a different input
   * and would otherwise paint one frame of the *previous* URL's data before an effect corrected it —
   * which on this app means a flash of the last client's numbers under the new client's name.
   */
  const [renderedKey, setRenderedKey] = useState(key);
  if (renderedKey !== key) {
    setRenderedKey(key);
    setData((STORE.get(key) as T) ?? null);
    setError("");
    setFresh(false);
  }

  useEffect(() => {
    if (!url) return;
    let live = true;
    void (async () => {
      try {
        const response = await fetch(url, { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
        if (!live) return;
        if (!response.ok || payload?.ok === false) {
          // A failed refresh does not throw away a good answer already on screen: the error is shown
          // beside the stale data rather than replacing it with nothing.
          setError(payload?.error || "That did not load.");
          return;
        }
        STORE.set(url, payload);
        setData(payload);
        setError("");
        setFresh(true);
      } catch {
        if (live) setError("That did not load.");
      }
    })();
    return () => { live = false; };
  }, [url, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading: !data && !error, fresh, reload };
}
