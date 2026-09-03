// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";
/* eslint-disable react-hooks/set-state-in-effect -- two genuinely mount-time reads: the collapse
   preference out of localStorage (unavailable during render) and closing the settings menu on
   navigation. Neither can be derived from props or state. */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useClientSlug } from "./useClientSlug";
import SettingsPanel from "./SettingsPanel";
import AppearanceControl from "./Appearance";

/**
 * The frame every signed-in page sits in.
 *
 * ── Whose portal am I in ────────────────────────────────────────────────────────────────────────
 * The brand at the top left is the client's, not QC's, whenever a client is in view. Staff move between
 * fifteen clients all day, and reading the wrong client's numbers is a real and easy mistake; putting
 * the logo and name where the eye already goes for orientation makes "which client is this" answerable
 * without looking for it. QC's own mark comes back on the directory, where there is no client to name.
 *
 * ── Why the client pages disappear ──────────────────────────────────────────────────────────────
 * Inbox, Database, Campaigns, Meetings and Pipeline are all views *of a client*. Shown before one is
 * picked they are links to a page whose only content is "pick a client first", which is a instruction
 * dressed up as a destination. So they are simply absent until there is a client to view — for a client
 * session that is always, and for staff it is the moment they open one.
 */
type Me = {
  user: { name: string; email: string; role: "staff" | "client" };
  client: { name: string; slug: string; logoUrl: string | null; accentColor: string | null } | null;
};

const ICONS: Record<string, string> = {
  overview: "M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 8h6V4h-6z",
  campaigns: "M4 19V9m5 10V5m5 14v-7m5 7V8",
  analytics: "M21 21H3V3M7 15l4-4 3 3 5-6",
  replies: "M20 15a3 3 0 0 1-3 3H8l-4 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z",
  database: "M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3M4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  meetings: "M4 6h16v14H4zM4 10h16M9 3v4M15 3v4",
  messaging: "M4 5h16v11H8l-4 4z",
  calls: "M8 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-2M8 3a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2M8 3v0M8 12h8M8 16h5",
  // The brain — a mind's outline, distinct from the sheet shapes the document tabs use.
  brain: "M9 3a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 1 5 3 3 0 0 0 4 2 3 3 0 0 0 3-2V4a1 1 0 0 0-1-1zM15 3a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-1 5 3 3 0 0 1-4 2 3 3 0 0 1-3-2",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9 2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2 2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9 2 2 0 1 1 0 4 1.7 1.7 0 0 0-1.6 1z",
  admin: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  // A grid of cards — the client directory, distinct from the single-person shape "admin" uses.
  clients: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  collapse: "M15 6l-6 6 6 6",
  signout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
};

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

/** Remembered per browser, because a sidebar that reopens on every navigation is not collapsed. */
const COLLAPSE_KEY = "qc-portal:sidebar-collapsed";
/**
 * Who the sidebar last knew you to be, per client.
 *
 * The layout keeps the shell mounted, so this only matters on a hard load — but on a hard load the
 * answer takes a round trip, and until it lands the brand would fall back to QC's mark. A client
 * opening their own portal should never see another company's branding, not even for 200ms, so the
 * last answer is read back synchronously and shown while the fresh one is fetched.
 */
const ME_KEY = "qc-portal:me";

function cachedMe(clientParam: string | null): Me | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(`${ME_KEY}:${clientParam ?? ""}`);
    return raw ? (JSON.parse(raw) as Me) : null;
  } catch {
    return null;
  }
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const clientParam = useClientSlug();

  // Seeded from the cache in the initialiser, so the first paint already carries the right brand.
  const [me, setMe] = useState<Me | null>(() => cachedMe(clientParam));
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const pathname = usePathname();
  const suffix = clientParam ? `?client=${encodeURIComponent(clientParam)}` : "";
  // Clean path URLs: a client's pages live at /{slug} and /{slug}/{tab} (real [client] route segments).
  const clientPrefix = clientParam ? `/${clientParam}` : "";
  const clientHref = (tabHref: string) => (clientPrefix ? `${clientPrefix}${tabHref === "/" ? "" : tabHref}` : `${tabHref}${suffix}`);
  // The tab for nav highlighting, with the /{slug} prefix stripped so it still matches item.href ("/messaging").
  const activeTab = clientPrefix && pathname.startsWith(clientPrefix) ? (pathname.slice(clientPrefix.length) || "/") : pathname;

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* a browser refusing storage just gets the default */
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((was) => {
      const next = !was;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* the preference is a convenience, not a requirement */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const query = clientParam ? `?client=${encodeURIComponent(clientParam)}` : "";
        const response = await fetch(`/api/me${query}`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as Me;
        setMe(payload);
        try {
          window.sessionStorage.setItem(`${ME_KEY}:${clientParam ?? ""}`, JSON.stringify(payload));
        } catch {
          /* the cache is a nicety; the fetch above is the source of truth */
        }
      } catch {
        /* the shell renders without a name rather than not at all */
      }
    })();
  }, [clientParam]);

  // The fleet health verdict, for the red dot on the Admin nav. Staff only, and read from the cheap
  // cached endpoint the watchdog writes, so it costs one row and never recomputes the whole page.
  const [healthBad, setHealthBad] = useState(false);
  useEffect(() => {
    if (me?.user.role !== "staff") return;
    let live = true;
    const check = async () => {
      try {
        const response = await fetch("/api/admin/health-summary", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (live) setHealthBad(payload?.level === "bad");
      } catch { /* the dot is a nicety; its absence is not a failure */ }
    };
    void check();
    // Every couple of minutes is plenty — the watchdog itself runs every five.
    const timer = setInterval(check, 120_000);
    return () => { live = false; clearInterval(timer); };
  }, [me?.user.role]);

  // Close the settings menu on any navigation, so it never hangs over the next page.
  useEffect(() => setSettingsOpen(false), [pathname, clientParam]);

  /**
   * A client session always has a client. A staff session has one only once they have opened it, and
   * `me.client` is null for staff — so the URL is what says whether staff are inside a client.
   */
  const inClient = me?.user.role === "client" || Boolean(clientParam);
  const brandClient = me?.client ?? null;

  // The browser tab wears the client's identity, not QC's: "Arcjet Dashboard" with Arcjet's logo as the
  // favicon whenever a client is in view, falling back to QC on the directory. A client watching their own
  // portal should see themselves in the tab strip, the same reason the top-left mark is theirs.
  useEffect(() => {
    const name = inClient && brandClient ? brandClient.name : "";
    document.title = name ? `${name} Dashboard` : "QC Growth";
    const logo = inClient && brandClient?.logoUrl ? brandClient.logoUrl : "";
    // Replace the icon element rather than mutating its href: changing href on an existing <link rel=icon>
    // is ignored by several browsers, and Next injects its own icon links that would otherwise win. Remove
    // them all, add a fresh one, and let the browser sniff the image type (a wrong `type` gets it rejected).
    document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"]').forEach((el) => el.remove());
    const link = document.createElement("link");
    link.rel = "icon";
    link.href = logo || "/favicon.ico";
    document.head.appendChild(link);
  }, [inClient, brandClient?.name, brandClient?.logoUrl, pathname]);

  const clientPages: { href: string; label: string; icon: string }[] = [
    { href: "/", label: "Overview", icon: "overview" },
    { href: "/inbox", label: "Inbox", icon: "replies" },
    { href: "/database", label: "Database", icon: "database" },
    { href: "/campaigns", label: "Campaigns", icon: "campaigns" },
    { href: "/analytics", label: "Analytics", icon: "analytics" },
    { href: "/meetings", label: "Meetings", icon: "meetings" },
    { href: "/messaging", label: "Messaging", icon: "messaging" },
    { href: "/brain", label: "Brain", icon: "brain" },
    { href: "/calls", label: "Weekly calls", icon: "calls" },
  ];

  /** The mark at the top left: the client's when there is one, QC's when there is not. */
  const brand = (() => {
    // Nothing known yet, and no cache to answer from. A neutral placeholder rather than QC's mark,
    // because guessing wrong here means a client watches another company's branding appear on their
    // own portal — better to show a shape for one frame than the wrong answer.
    if (!me) {
      return (
        <>
          <span className="brand-mark brand-mark-pending" aria-hidden="true" />
          {!collapsed && <span className="brand-name brand-name-pending" aria-hidden="true" />}
        </>
      );
    }
    if (inClient && brandClient) {
      return (
        <>
          <span
            className="brand-mark brand-mark-client"
            style={brandClient.logoUrl ? undefined : { background: brandClient.accentColor || "var(--accent)" }}
          >
            {brandClient.logoUrl ? <img src={brandClient.logoUrl} alt="" /> : (brandClient.name[0] || "?").toUpperCase()}
          </span>
          {!collapsed && <span className="brand-name">{brandClient.name}</span>}
        </>
      );
    }
    /*
     * The banner lockup rather than the mark beside typed-out "QC Growth".
     *
     * Collapsed, the sidebar is too narrow for a 3.9:1 image, so the square mark stands in — the same
     * artwork the favicon uses, which is what the collapsed rail wants anyway: a recognisable dot.
     */
    return collapsed ? (
      <span className="brand-mark brand-mark-qc">
        <img src="/qc-growth-logo.png" alt="QC Growth" />
      </span>
    ) : (
      <img className="brand-banner" src="/qc-growth-banner.png" alt="QC Growth" />
    );
  })();

  return (
    <div className={`shell ${collapsed ? "is-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-head">
          <Link href={inClient ? (clientPrefix || "/") : "/"} className="brand" title={brandClient?.name ?? "QC Growth"}>
            {brand}
          </Link>
          <button
            className="sidebar-icon sidebar-collapse"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand the menu" : "Collapse the menu"}
            title={collapsed ? "Expand" : "Collapse"}
          >
            <Icon name="collapse" />
          </button>
        </div>

        <nav className="nav">
          {/*
            * The way back to the directory, for staff only.
            *
            * It used to appear only when no client was open, which meant that once you were inside one
            * the only route out was the browser's back button. Staff work across every client, so the
            * directory is a destination rather than a starting screen — and a client session must never
            * see it, since the directory is the list of everybody else.
            */}
          {me?.user.role === "staff" && (
            <Link
              href="/"
              prefetch={false}
              className={`nav-item ${pathname === "/" && !inClient ? "active" : ""}`}
              title="Clients"
            >
              <Icon name="clients" />
              {!collapsed && "Clients"}
            </Link>
          )}

          {inClient &&
            clientPages.map((item) => (
              <Link
                key={item.href}
                href={clientHref(item.href)}
                // Prefetch off: with it on, a tab click updated the URL but left the old page on screen
                // until a second click. Fetching the route on click instead makes navigation commit the
                // first time. The route trees are small, so the cost is negligible.
                prefetch={false}
                className={`nav-item ${activeTab === item.href ? "active" : ""}`}
                title={item.label}
              >
                <Icon name={item.icon} />
                {!collapsed && item.label}
              </Link>
            ))}
        </nav>

        <div className="sidebar-foot">
          {me?.user.role === "staff" && (
            <Link href={healthBad ? "/admin/ops" : "/admin"} prefetch={false} className={`nav-item ${pathname.startsWith("/admin") ? "active" : ""}`} title={healthBad ? "Admin — something needs attention" : "Admin"}>
              <span className="nav-icon-wrap">
                <Icon name="admin" />
                {healthBad && <i className="nav-alert-dot" aria-hidden="true" />}
              </span>
              {!collapsed && "Admin"}
              {healthBad && !collapsed && <i className="nav-alert-dot inline" aria-hidden="true" />}
            </Link>
          )}
          <button
            className={`nav-item ${settingsOpen ? "active" : ""}`}
            onClick={() => setSettingsOpen(true)}
            title="Settings"
          >
            <Icon name="settings" />
            {!collapsed && "Settings"}
          </button>

          {/* Who you are signed in as, at the foot where it is out of the way but never in doubt. */}
          {me && !collapsed && (
            <div className="who">
              <strong>{me.user.name || me.user.email}</strong>
              <span>{me.user.role === "staff" ? "QC team" : (me.client?.name ?? "Client")}</span>
            </div>
          )}
        </div>
      </aside>

      <main className="main">
        {/* Thin bar over every page, holding the one control that belongs to the whole app. */}
        <header className="topbar">
          <span />
          <div className="top-actions">
            <AppearanceControl />
          </div>
        </header>
        {/* The page scrolls inside this, so the sidebar and topbar never move. */}
        <div className="page-scroll">{children}</div>
      </main>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
