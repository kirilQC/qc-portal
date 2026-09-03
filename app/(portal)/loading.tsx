// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/** The directory-level loading skeleton, shown while the staff client list arrives. */
export default function Loading() {
  return (
    <div className="content sk">
      <div className="sk-head">
        <div className="sk-logo sk-sh" />
        <div className="sk-title sk-sh" />
      </div>
      <div className="sk-tiles">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="sk-tile sk-sh" />
        ))}
      </div>
    </div>
  );
}
