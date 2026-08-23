// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

/**
 * Messaging — the copy each campaign actually sent.
 *
 * A placeholder on purpose. The data for it already exists: `rr_campaign_stats` stores `first_touch`,
 * `follow_up` and `sequence_steps`, so this becomes the page that puts the words next to the rates they
 * produced. Left empty until the shape of that is decided rather than guessed at.
 */
export default function Page() {
  return (
    <div className="content">
      <div className="page-head">
        <h1>Messaging</h1>
      </div>
      <p className="empty">Nothing here yet.</p>
    </div>
  );
}
