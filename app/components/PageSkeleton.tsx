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

/**
 * A list page arriving: a title, a toolbar and rows (Inbox, Database, Meetings, Campaigns, Messaging).
 * `tiles` adds a strip of stat tiles above the list, for pages that open with figures.
 */
export function ListSkeleton({ rows = 8, tiles = 0 }: { rows?: number; tiles?: number }) {
  return (
    <div className="content sk">
      <div className="sk-head">
        <div className="sk-logo sk-sh" />
        <div className="sk-title sk-sh" />
      </div>
      {tiles > 0 && (
        <div className="sk-tiles">
          {Array.from({ length: tiles }).map((_, index) => <div key={index} className="sk-tile sk-sh" />)}
        </div>
      )}
      <div className="sk-toolbar sk-sh" />
      <SkeletonRows rows={rows} />
    </div>
  );
}

/** A board arriving: columns of cards (Project tracker). */
export function BoardSkeleton({ columns = 5 }: { columns?: number }) {
  return (
    <div className="content sk">
      <div className="sk-title sk-sh" style={{ marginBottom: 22 }} />
      <div className="sk-board">
        {Array.from({ length: columns }).map((_, column) => (
          <div key={column} className="sk-col sk-sh">
            {Array.from({ length: 3 - (column % 2) }).map((__, card) => <div key={card} className="sk-card" />)}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A reading page arriving: a heading and paragraphs (Brain, Weekly calls). */
export function DocSkeleton() {
  return (
    <div className="content sk">
      <div className="sk-title sk-sh" style={{ marginBottom: 22 }} />
      <div className="sk-doc">
        <div className="sk-side sk-sh" />
        <div className="sk-body sk-sh">
          {[92, 86, 74, 0, 88, 80, 62, 0, 90, 70].map((width, index) =>
            width ? <div key={index} className="sk-line" style={{ width: `${width}%` }} /> : <div key={index} className="sk-gap" />,
          )}
        </div>
      </div>
    </div>
  );
}

/** Shimmering rows for a list that is (re)loading inside a page that is already on screen. */
export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="sk-rows" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="sk-row sk-sh">
          <span className="sk-avatar" />
          <span className="sk-text"><i style={{ width: `${46 + ((index * 17) % 30)}%` }} /><i style={{ width: `${28 + ((index * 11) % 22)}%` }} /></span>
        </div>
      ))}
    </div>
  );
}
