// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * What a shared portal link shows in Slack, iMessage and the like.
 *
 * Those previews are fetched with no session, so every portal link lands on the login page with the path in
 * `next`. The client is read from that path, and the preview carries only their name and logo: things on
 * their own website already, never a figure.
 */
import { adminRows, str } from "./db";

export const SITE = (process.env.PORTAL_PUBLIC_URL || "https://www.qcgrowth.dev").replace(/\/+$/, "");
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** First path segments that are portal pages, not clients. */
const NOT_CLIENTS = new Set(["admin", "login", "api", "settings", "account"]);

export type PreviewClient = { slug: string; name: string; logo: string };

export function slugFromNext(next: string): string {
  if (!next.startsWith("/") || next.startsWith("//")) return "";
  const first = next.split(/[/?#]/)[1] ?? "";
  return SLUG.test(first) && !NOT_CLIENTS.has(first) ? first : "";
}

export async function previewClient(slug: string): Promise<PreviewClient | null> {
  if (!SLUG.test(slug) || slug === "misc") return null;
  const [row] = await adminRows("rr_workspaces", { select: "slug,name,logo_url", slug: `eq.${slug}`, limit: "1" }).catch(() => []);
  if (!row) return null;
  return { slug: str(row.slug), name: str(row.name), logo: str(row.logo_url) };
}
