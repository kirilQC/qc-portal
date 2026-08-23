// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import type { Client } from "./usePortal";

/** The client's logo and name, at the top of every page inside their portal. */
export default function ClientHead({ client, sub }: { client: Client; sub?: string }) {
  return (
    <div className="client-head">
      <span className="client-logo" style={client.logoUrl ? undefined : { background: client.accentColor || "var(--accent)" }}>
        {client.logoUrl ? <img src={client.logoUrl} alt="" /> : (client.name[0] || "?").toUpperCase()}
      </span>
      <div>
        <h1>{client.name}</h1>
        {sub && <p>{sub}</p>}
      </div>
    </div>
  );
}
