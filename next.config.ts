// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// Reply Radar — proprietary. Not licensed for redistribution or resale.

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // The App Router client-side cache serves a previously-fetched RSC for a route without re-fetching,
    // which showed up as "click a tab, URL changes, the old page stays until a second click". Zeroing the
    // stale windows makes every navigation fetch fresh so tab switches land on the first click.
    staleTimes: { dynamic: 0, static: 30 },
  },
};

export default nextConfig;
