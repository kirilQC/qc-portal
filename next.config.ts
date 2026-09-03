// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// Reply Radar — proprietary. Not licensed for redistribution or resale.

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No `experimental.staleTimes` here on purpose. The tab navigation would change the URL but leave the
  // old page on screen until a second click; that reconciliation bug tracks with the experimental
  // staleTimes flag + prefetch caching on this Next version, so the flag is removed entirely (defaults)
  // and the nav links disable prefetch (see Shell). Page data is fetched client-side with `no-store`
  // regardless, so nothing here affects freshness.
};

export default nextConfig;
