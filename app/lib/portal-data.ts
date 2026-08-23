// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * Everything a client is shown, read through the scoped wall and nowhere else.
 *
 * ── What is deliberately not here ───────────────────────────────────────────────────────────────
 * Reply Radar holds a great deal per client that has no business on a client's screen: their API keys,
 * the onboarding checklist, do-not-contact lists, AI scoring reasons, internal Slack briefs, campaign
 * approval state. None of it is fetched here. This module names, field by field, the small set that is
 * theirs to see — so the question "could a client see X" is answered by reading one file, rather than
 * by auditing every query in the app.
 *
 * ── Why the numbers are computed the way Reply Radar computes them ──────────────────────────────
 * Acceptance is out of requests sent; reply rate and positive-reply rate are out of connections
 * *accepted*, not sent, because nobody can reply to a request that was never accepted. That convention
 * is Reply Radar's and it is reproduced exactly, so a client reading their portal and QC reading the
 * internal tool are never looking at two different versions of the same percentage.
 *
 * ── Why pipeline shows confirmed separately ─────────────────────────────────────────────────────
 * Attribution is conservative by design: "confirmed" means a specific person QC contacted or met turned
 * up on the deal, "possible" means only the company domain matched. A client is shown both, labelled,
 * and the headline figure is the confirmed one. Overstating attribution to a client is the fastest way
 * to lose the argument about what outbound is worth.
 */
import { num, scopedRows, str, type Row } from "./db";
import type { Session } from "./session";

export type ClientSummary = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  accentColor: string | null;
  websiteUrl: string | null;
};

export type CampaignRow = {
  campaignId: string;
  name: string;
  status: string | null;
  launchedAt: string | null;
  totalLeads: number;
  connectionsSent: number;
  connectionsAccepted: number;
  replies: number;
  acceptanceRate: number;
  replyRate: number;
};

export type DailyPoint = { day: string; connectionsSent: number; connectionsAccepted: number; replies: number };

export type MeetingRow = {
  id: string;
  inviteeName: string | null;
  inviteeTitle: string | null;
  inviteeLinkedin: string | null;
  companyName: string | null;
  companyDomain: string | null;
  companyIndustry: string | null;
  companySize: string | null;
  meetingAt: string | null;
  whenText: string | null;
  summary: string | null;
  status: string;
  campaign: string | null;
};

export type DealRow = {
  id: string;
  name: string | null;
  amount: number | null;
  currency: string | null;
  stage: string | null;
  status: string;
  closeDate: string | null;
  contactName: string | null;
  companyName: string | null;
  attribution: string;
  attributionReason: string | null;
  attributionCampaign: string | null;
};

export type ReplyRow = {
  id: string;
  name: string | null;
  role: string | null;
  company: string | null;
  linkedinUrl: string | null;
  lastMessageAt: string | null;
  campaign: string | null;
};

export type Overview = {
  connectionsSent: number;
  connectionsAccepted: number;
  acceptanceRate: number;
  replies: number;
  replyRate: number;
  positiveReplies: number;
  meetingsBooked: number;
  meetingsUpcoming: number;
  confirmedPipeline: number;
  possiblePipeline: number;
  campaignsRunning: number;
  campaignsTotal: number;
  startedAt: string | null;
};

/** The client's own identity — the only workspace columns a client is ever shown. */
export async function getClient(session: Session, workspaceId: string): Promise<ClientSummary | null> {
  const rows = await scopedRows(
    session,
    "rr_workspaces",
    { select: "id,name,slug,logo_url,accent_color,website_url", limit: "1" },
    workspaceId,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: str(row.id),
    name: str(row.name),
    slug: str(row.slug),
    logoUrl: row.logo_url ? str(row.logo_url) : null,
    accentColor: row.accent_color ? str(row.accent_color) : null,
    websiteUrl: row.website_url ? str(row.website_url) : null,
  };
}

/** Every client, for the staff directory. Never reachable from a client session — scopedRows sees to it. */
export async function listClients(session: Session): Promise<ClientSummary[]> {
  const rows = await scopedRows(session, "rr_workspaces", {
    select: "id,name,slug,logo_url,accent_color,website_url",
    order: "name.asc",
  });
  return rows.map((row) => ({
    id: str(row.id),
    name: str(row.name),
    slug: str(row.slug),
    logoUrl: row.logo_url ? str(row.logo_url) : null,
    accentColor: row.accent_color ? str(row.accent_color) : null,
    websiteUrl: row.website_url ? str(row.website_url) : null,
  }));
}

const rate = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

function toCampaign(row: Row): CampaignRow {
  const sent = num(row.connections_sent);
  const accepted = num(row.connections_accepted);
  const replies = num(row.replies);
  return {
    campaignId: str(row.campaign_id),
    name: str(row.name),
    status: row.status ? str(row.status) : null,
    launchedAt: row.launched_at ? str(row.launched_at) : null,
    totalLeads: num(row.total_leads),
    connectionsSent: sent,
    connectionsAccepted: accepted,
    replies,
    acceptanceRate: rate(accepted, sent),
    // Out of accepted, not sent — see the module note.
    replyRate: rate(replies, accepted),
  };
}

export async function getCampaigns(session: Session, workspaceId: string): Promise<CampaignRow[]> {
  const rows = await scopedRows(
    session,
    "rr_campaign_stats",
    { select: "campaign_id,name,status,launched_at,total_leads,connections_sent,connections_accepted,replies" },
    workspaceId,
  );
  return rows.map(toCampaign).sort((a, b) => b.connectionsSent - a.connectionsSent);
}

/** The daily series, account-wide. `sender_id=''` is Reply Radar's reserved account-total row. */
export async function getDaily(session: Session, workspaceId: string, days = 30): Promise<DailyPoint[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = await scopedRows(
    session,
    "rr_daily_stats",
    {
      select: "day,connections_sent,connections_accepted,replies",
      sender_id: "eq.",
      day: `gte.${since}`,
      order: "day.asc",
    },
    workspaceId,
  );
  return rows.map((row) => ({
    day: str(row.day),
    connectionsSent: num(row.connections_sent),
    connectionsAccepted: num(row.connections_accepted),
    replies: num(row.replies),
  }));
}

export async function getMeetings(session: Session, workspaceId: string): Promise<MeetingRow[]> {
  const rows = await scopedRows(
    session,
    "rr_meetings",
    {
      select:
        "id,invitee_name,invitee_title,invitee_linkedin,company_name,company_domain,company_industry,company_size,meeting_at,when_text,summary,status,campaign",
      order: "meeting_at.desc",
      limit: "500",
    },
    workspaceId,
  );
  return rows.map((row) => ({
    id: str(row.id),
    inviteeName: row.invitee_name ? str(row.invitee_name) : null,
    inviteeTitle: row.invitee_title ? str(row.invitee_title) : null,
    inviteeLinkedin: row.invitee_linkedin ? str(row.invitee_linkedin) : null,
    companyName: row.company_name ? str(row.company_name) : null,
    companyDomain: row.company_domain ? str(row.company_domain) : null,
    companyIndustry: row.company_industry ? str(row.company_industry) : null,
    companySize: row.company_size ? str(row.company_size) : null,
    meetingAt: row.meeting_at ? str(row.meeting_at) : null,
    whenText: row.when_text ? str(row.when_text) : null,
    summary: row.summary ? str(row.summary) : null,
    status: str(row.status) || "scheduled",
    campaign: row.campaign ? str(row.campaign) : null,
  }));
}

export async function getDeals(session: Session, workspaceId: string): Promise<DealRow[]> {
  const rows = await scopedRows(
    session,
    "rr_deals",
    {
      select:
        "id,name,amount,currency,stage,status,close_date,contact_name,company_name,attribution,attribution_reason,attribution_campaign",
      order: "amount.desc",
      limit: "500",
    },
    workspaceId,
  );
  const weight: Record<string, number> = { confirmed: 0, possible: 1, none: 2 };
  return rows
    .map((row) => ({
      id: str(row.id),
      name: row.name ? str(row.name) : null,
      amount: row.amount == null ? null : num(row.amount),
      currency: row.currency ? str(row.currency) : null,
      stage: row.stage ? str(row.stage) : null,
      status: str(row.status) || "open",
      closeDate: row.close_date ? str(row.close_date) : null,
      contactName: row.contact_name ? str(row.contact_name) : null,
      companyName: row.company_name ? str(row.company_name) : null,
      attribution: str(row.attribution) || "none",
      attributionReason: row.attribution_reason ? str(row.attribution_reason) : null,
      attributionCampaign: row.attribution_campaign ? str(row.attribution_campaign) : null,
    }))
    // Confirmed first — the deals a client can be certain came from this work lead the list.
    .sort((a, b) => (weight[a.attribution] ?? 3) - (weight[b.attribution] ?? 3) || (b.amount ?? 0) - (a.amount ?? 0));
}

/**
 * Who has replied, most recent first.
 *
 * The message *bodies* are deliberately not read. A client seeing who engaged, from where, and when is
 * useful; a client reading the full text of every conversation their agency is having on their behalf
 * is a different product with a different set of consent questions attached to it. The identity of the
 * person and the campaign that reached them is the honest half of that.
 */
export async function getReplies(session: Session, workspaceId: string, limit = 100): Promise<ReplyRow[]> {
  const conversations = await scopedRows(
    session,
    "rr_conversations",
    {
      select: "id,lead_id,last_message_at",
      last_message_direction: "eq.inbound",
      order: "last_message_at.desc",
      limit: String(limit),
    },
    workspaceId,
  );
  const leadIds = [...new Set(conversations.map((row) => str(row.lead_id)).filter(Boolean))];
  if (!leadIds.length) return [];

  const leads = await scopedRows(
    session,
    "rr_leads",
    {
      select: "id,name,role,company,linkedin_profile_url,campaign_names",
      id: `in.(${leadIds.join(",")})`,
      limit: String(limit),
    },
    workspaceId,
  );
  const byId = new Map(leads.map((row) => [str(row.id), row]));

  return conversations
    .map((row) => {
      const lead = byId.get(str(row.lead_id));
      if (!lead) return null;
      return {
        id: str(row.id),
        name: lead.name ? str(lead.name) : null,
        role: lead.role ? str(lead.role) : null,
        company: lead.company ? str(lead.company) : null,
        linkedinUrl: lead.linkedin_profile_url ? str(lead.linkedin_profile_url) : null,
        lastMessageAt: row.last_message_at ? str(row.last_message_at) : null,
        campaign: lead.campaign_names ? str(lead.campaign_names) : null,
      };
    })
    .filter((row): row is ReplyRow => row !== null);
}

/** The headline numbers, assembled from the same reads the detail pages use. */
export async function getOverview(session: Session, workspaceId: string): Promise<Overview> {
  const [campaigns, meetings, deals] = await Promise.all([
    getCampaigns(session, workspaceId),
    getMeetings(session, workspaceId),
    getDeals(session, workspaceId),
  ]);

  const connectionsSent = campaigns.reduce((sum, row) => sum + row.connectionsSent, 0);
  const connectionsAccepted = campaigns.reduce((sum, row) => sum + row.connectionsAccepted, 0);
  const replies = campaigns.reduce((sum, row) => sum + row.replies, 0);

  const now = Date.now();
  const upcoming = meetings.filter((row) => row.meetingAt && Date.parse(row.meetingAt) > now).length;

  const sum = (rows: DealRow[]) => rows.reduce((total, row) => total + (row.amount ?? 0), 0);

  const launched = campaigns
    .map((row) => row.launchedAt)
    .filter((value): value is string => Boolean(value))
    .sort();

  return {
    connectionsSent,
    connectionsAccepted,
    acceptanceRate: rate(connectionsAccepted, connectionsSent),
    replies,
    replyRate: rate(replies, connectionsAccepted),
    positiveReplies: 0,
    meetingsBooked: meetings.length,
    meetingsUpcoming: upcoming,
    confirmedPipeline: sum(deals.filter((row) => row.attribution === "confirmed")),
    possiblePipeline: sum(deals.filter((row) => row.attribution === "possible")),
    campaignsRunning: campaigns.filter((row) => (row.status ?? "").toLowerCase() === "active").length,
    campaignsTotal: campaigns.length,
    startedAt: launched[0] ?? null,
  };
}
