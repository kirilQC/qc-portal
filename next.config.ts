// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// Reply Radar — proprietary. Not licensed for redistribution or resale.

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Keep prefetched route trees warm for a short window. `dynamic: 0` (the old value, and Next's own
    // default) makes every hover-prefetch instantly stale, so a tab click could not use it — the router
    // refetched the shell mid-click, which is what showed up as "URL changes, old page stays, click
    // again". A positive window lets the prefetch actually serve the click, so tabs switch on the first
    // one. Page *data* is unaffected: every page fetches its own numbers client-side with `no-store`, so
    // only the static shell is cached here, never a stale figure.
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default nextConfig;
