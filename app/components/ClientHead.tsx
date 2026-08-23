// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Client } from "./usePortal";

/**
 * The client's logo and name, at the top of every page inside their portal.
 *
 * The way back to the directory appears only for staff, because only staff have a directory to go back
 * to — a client's portal contains exactly one client, so "All clients" would be a link to a page that
 * refuses them. Whether to show it is therefore a question about the session, not about the URL.
 */
export default function ClientHead({ client, sub }: { client: Client; sub?: string }) {
  const [isStaff, setIsStaff] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/me", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { user?: { role?: string } };
        setIsStaff(payload.user?.role === "staff");
      } catch {
        /* no link is the safe default */
      }
    })();
  }, []);

  return (
    <div className="client-head">
      <span className="client-logo" style={client.logoUrl ? undefined : { background: client.accentColor || "var(--accent)" }}>
        {client.logoUrl ? <img src={client.logoUrl} alt="" /> : (client.name[0] || "?").toUpperCase()}
      </span>
      <div>
        {isStaff && (
          <Link href="/" className="back-link">
            ← All clients
          </Link>
        )}
        <h1>{client.name}</h1>
        {sub && <p>{sub}</p>}
      </div>
    </div>
  );
}
