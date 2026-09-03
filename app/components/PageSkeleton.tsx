// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * The shimmer placeholder shown while a page's data is in flight.
 *
 * Used both by the route `loading.tsx` (during the navigation itself) and by each page's own loading
 * state (during its client-side fetch, which is the longer wait), so the two hand off to one another
 * seamlessly and a tab never flashes a bare "Loading…".
 */
export function PageSkeleton({ tiles = 4 }: { tiles?: number }) {
  return (
    <div className="content sk">
      <div className="sk-head">
        <div className="sk-logo sk-sh" />
        <div className="sk-title sk-sh" />
      </div>
      <div className="sk-hero sk-sh" />
      <div className="sk-tiles">
        {Array.from({ length: tiles }).map((_, index) => (
          <div key={index} className="sk-tile sk-sh" />
        ))}
      </div>
      <div className="sk-panel sk-sh" />
    </div>
  );
}
