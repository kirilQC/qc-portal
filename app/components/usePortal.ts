// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { useSearchParams } from "next/navigation";
import { useCachedJson } from "./cache";

/**
 * The one fetch every page makes.
 *
 * All five pages are views of the same payload, so they share one request and one loading state rather
 * than each inventing their own. `?client=` is passed through for staff; for a client session the
 * server ignores it entirely, so there is no need to special-case it here.
 */

export type Client = { id: string; name: string; slug: string; logoUrl: string | null; accentColor: string | null; websiteUrl: string | null };

export type Overview = {
  connectionsSent: number; connectionsAccepted: number; acceptanceRate: number;
  replies: number; replyRate: number; positiveReplies: number;
  meetingsBooked: number; meetingsUpcoming: number;
  confirmedPipeline: number; possiblePipeline: number;
  campaignsRunning: number; campaignsTotal: number; startedAt: string | null;
};

export type Campaign = {
  campaignId: string; name: string; status: string | null; launchedAt: string | null;
  senders: string[];
  totalLeads: number; connectionsSent: number; connectionsAccepted: number; replies: number;
  positiveReplies: number;
  /** How many replies have been through sentiment analysis. Zero means the positive rate is unknown. */
  scoredReplies: number;
  /** The newest message attributable to this campaign — where its run is taken to have ended. */
  lastActivityAt: string | null;
  acceptanceRate: number; replyRate: number; positiveReplyRate: number;
};

export type DailyPoint = { day: string; connectionsSent: number; connectionsAccepted: number; replies: number };

export type Meeting = {
  id: string; inviteeName: string | null; inviteeTitle: string | null; inviteeLinkedin: string | null;
  companyName: string | null; companyDomain: string | null; companyIndustry: string | null; companySize: string | null;
  meetingAt: string | null; whenText: string | null; summary: string | null; status: string; campaign: string | null;
};

export type Deal = {
  id: string; name: string | null; amount: number | null; currency: string | null;
  stage: string | null; status: string; closeDate: string | null;
  contactName: string | null; companyName: string | null;
  attribution: string; attributionReason: string | null; attributionCampaign: string | null;
};

export type Reply = {
  id: string; name: string | null; role: string | null; company: string | null;
  linkedinUrl: string | null; lastMessageAt: string | null; campaign: string | null;
};

export type PortalData = {
  ok: boolean;
  view: "client" | "directory";
  role?: "staff" | "client";
  client?: Client;
  clients?: Client[];
  overview?: Overview;
  campaigns?: Campaign[];
  daily?: DailyPoint[];
  meetings?: Meeting[];
  deals?: Deal[];
  replies?: Reply[];
  error?: string;
};

/**
 * The one fetch every page makes, served from cache while it revalidates.
 *
 * Each tab is its own route, so this hook used to remount and start from nothing on every navigation —
 * a blank "Loading…" for a payload the previous tab had fetched a second earlier. It now hands back the
 * last good answer immediately and replaces it when the request returns, so moving between tabs after
 * the first load costs nothing on screen.
 */
export function usePortal() {
  const params = useSearchParams();
  const client = params.get("client");
  const url = `/api/portal${client ? `?client=${encodeURIComponent(client)}` : ""}`;
  const { data, error, loading } = useCachedJson<PortalData>(url);
  return { data, error, loading, clientSlug: client };
}

/** Money, the way a client expects to read it: no cents, grouped, with the symbol. */
export function money(value: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `$${Math.round(value).toLocaleString()}`;
  }
}

/** A date a person can read, without the time — these are all day-scale facts. */
export function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** A date with the time, for meetings, where the hour is the point. */
export function dateTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
