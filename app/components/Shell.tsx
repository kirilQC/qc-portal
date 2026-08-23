// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * The frame every signed-in page sits in.
 *
 * ── Why the navigation is built from the session ────────────────────────────────────────────────
 * The admin link only exists for staff. That is presentation, not security — the middleware and the
 * route both refuse a client outright — but a link a client cannot use should not be on their screen
 * asking to be clicked.
 *
 * ── Why the client's name is in the sidebar and not just the page ───────────────────────────────
 * When QC's own team is looking at a client, the whole shell says whose data is on screen. Reading the
 * wrong client's numbers and acting on them is a real mistake, and the fix is to make it impossible to
 * be a page deep and unsure.
 */
type Me = {
  user: { name: string; email: string; role: "staff" | "client" };
  client: { name: string; slug: string; logoUrl: string | null; accentColor: string | null } | null;
};

const ICONS: Record<string, string> = {
  overview: "M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 8h6V4h-6z",
  campaigns: "M4 19V9m5 10V5m5 14v-7m5 7V8",
  replies: "M20 15a3 3 0 0 1-3 3H8l-4 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z",
  meetings: "M4 6h16v14H4zM4 10h16M9 3v4M15 3v4",
  deals: "M3 7h18v12H3zM3 11h18M8 7V5h8v2",
  admin: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9 2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2 2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9 2 2 0 1 1 0 4 1.7 1.7 0 0 0-1.6 1z",
};

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const pathname = usePathname();
  const params = useSearchParams();
  const client = params.get("client");
  /** Staff browsing one client keep the `?client=` on every link, or the nav would drop them home. */
  const suffix = client ? `?client=${encodeURIComponent(client)}` : "";

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/me", { cache: "no-store" });
        if (response.ok) setMe((await response.json()) as Me);
      } catch {
        /* the shell renders without a name rather than not at all */
      }
    })();
  }, []);

  const items: { href: string; label: string; icon: string }[] = [
    { href: "/", label: "Overview", icon: "overview" },
    { href: "/campaigns", label: "Campaigns", icon: "campaigns" },
    { href: "/replies", label: "Replies", icon: "replies" },
    { href: "/meetings", label: "Meetings", icon: "meetings" },
    { href: "/deals", label: "Pipeline", icon: "deals" },
  ];

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href={`/${suffix}`} className="brand">
          <span className="brand-mark">QC</span>
          <span className="brand-name">
            QC <span>Growth</span>
          </span>
        </Link>

        <nav className="nav">
          {items.map((item) => (
            <Link
              key={item.href}
              href={`${item.href}${suffix}`}
              className={`nav-item ${pathname === item.href ? "active" : ""}`}
            >
              <Icon name={item.icon} />
              {item.label}
            </Link>
          ))}
          {me?.user.role === "staff" && (
            <Link href="/admin" className={`nav-item ${pathname.startsWith("/admin") ? "active" : ""}`}>
              <Icon name="admin" />
              Logins
            </Link>
          )}
        </nav>

        <div className="sidebar-foot">
          {me && (
            <div className="who">
              <strong>{me.user.name || me.user.email}</strong>
              <span>{me.user.role === "staff" ? "QC team" : (me.client?.name ?? "Client")}</span>
            </div>
          )}
          <button className="signout" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="main">{children}</main>
    </div>
  );
}
