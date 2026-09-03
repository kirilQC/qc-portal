// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * The instant a tab is clicked, this shows — a shimmer shaped like the page arriving — so navigation
 * always produces immediate feedback and the previous tab never lingers on screen. It replaces the bare
 * "Loading…" each page used to flash while it fetched, and it gives the router a real transition
 * boundary so the first click, not the second, is the one that swaps the view.
 */
export default function Loading() {
  return (
    <div className="content sk">
      <div className="sk-head">
        <div className="sk-logo sk-sh" />
        <div className="sk-title sk-sh" />
      </div>
      <div className="sk-hero sk-sh" />
      <div className="sk-tiles">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="sk-tile sk-sh" />
        ))}
      </div>
      <div className="sk-panel sk-sh" />
    </div>
  );
}
