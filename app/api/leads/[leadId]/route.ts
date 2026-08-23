// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * Everything held on one lead: the full enrichment, and every conversation they have had.
 *
 * ── Why this is a second request rather than more columns on the list ───────────────────────────
 * `raw_data` on an enriched lead is tens of kilobytes — a full employment history, education, company
 * profile and the original provider payload. Fifty of those is a several-megabyte response to draw a
 * table that shows six fields per row. So the list stays lean and this is fetched when a row is opened,
 * which is the only moment any of it is looked at.
 *
 * ── Ownership ───────────────────────────────────────────────────────────────────────────────────
 * The lead is read through the scoped path, so a lead id belonging to another client simply is not
 * found. The conversations are read the same way, and the messages through the path that proves
 * ownership of each conversation first — no part of this widens what the session can reach.
 */
import { NextResponse } from "next/server";
import { resolveScope } from "../../../lib/auth-context";
import { num, scopedByConversation, scopedRows, str } from "../../../lib/db";
import {
  companySize, departmentLabels, list, locationLabel, positionGroup, school, text, urlOrNull,
} from "../../../../shared/enrichment.mjs";

export const maxDuration = 60;

type Rec = Record<string, unknown>;
const asRecord = (value: unknown): Rec => (value && typeof value === "object" && !Array.isArray(value) ? (value as Rec) : {});

export async function GET(request: Request, { params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  const slug = new URL(request.url).searchParams.get("client");

  let scope;
  try {
    scope = await resolveScope(slug);
  } catch {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }
  const { session, workspaceId } = scope;
  if (!workspaceId) return NextResponse.json({ ok: false, error: "Pick a client first." }, { status: 400 });

  try {
    const rows = await scopedRows(
      session,
      "rr_leads",
      {
        select: "id,name,role,company,linkedin_profile_url,linkedin_id,raw_data,created_at",
        id: `eq.${leadId}`,
        limit: "1",
      },
      workspaceId,
    );
    const row = rows[0];
    if (!row) return NextResponse.json({ ok: false, error: "That lead was not found." }, { status: 404 });

    const raw = asRecord(row.raw_data);
    const radar = asRecord(raw.reply_radar);
    const ai = asRecord(radar.ai_ark);
    const rollup = asRecord(radar.rollup);
    const company = asRecord(ai.company);
    const summary = asRecord(company.summary);
    const links = asRecord(company.link);
    const network = asRecord(asRecord(ai.statistics).network);

    // Their conversations, and every message in them.
    const conversations = await scopedRows(
      session,
      "rr_conversations",
      {
        select: "id,score,tier,score_reason,last_message_at,last_message_direction",
        lead_id: `eq.${leadId}`,
        order: "last_message_at.desc",
        limit: "50",
      },
      workspaceId,
    );
    const conversationIds = conversations.map((conversation) => str(conversation.id)).filter(Boolean);
    const messages = conversationIds.length
      ? await scopedByConversation(
          session,
          "rr_messages",
          conversationIds,
          { select: "id,conversation_id,direction,body,sent_at,raw_data", order: "sent_at.asc", limit: "2000" },
          workspaceId,
        )
      : [];

    const threads = conversations.map((conversation) => {
      const id = str(conversation.id);
      return {
        id,
        score: num(conversation.score),
        tier: str(conversation.tier),
        reason: str(conversation.score_reason),
        lastMessageAt: conversation.last_message_at ? str(conversation.last_message_at) : null,
        messages: messages
          .filter((message) => str(message.conversation_id) === id)
          .map((message) => {
            const direction = str(message.direction) === "outbound" ? "outbound" : "inbound";
            const sender = text(asRecord(asRecord(message.raw_data).reply_radar).sender);
            return {
              id: str(message.id),
              direction,
              body: str(message.body),
              sentAt: str(message.sent_at),
              authorName: direction === "outbound" ? sender || "QC" : str(row.name) || "Them",
            };
          }),
      };
    });

    return NextResponse.json({
      ok: true,
      lead: {
        id: str(row.id),
        name: str(row.name) || "Unnamed",
        role: str(row.role) || text(ai.title),
        company: str(row.company) || text(summary.name) || text(company),
        profileUrl: row.linkedin_profile_url ? str(row.linkedin_profile_url) : null,
        linkedinId: row.linkedin_id ? str(row.linkedin_id) : null,
        photoUrl: text(ai.profilePhotoSource) || text(ai.profilePhotoUrl) || null,
        companyPhotoUrl: text(ai.companyPhotoSource) || text(ai.companyPhotoUrl) || null,
        createdAt: str(row.created_at),

        // Contact and profile.
        email: text(raw.email_address) || text(raw.custom_email) || text(raw.enriched_email) || null,
        location: locationLabel(ai.location ?? raw.location),
        headline: text(ai.headline) || null,
        industry: text(ai.industry) || null,
        summary: text(ai.summary) || text(raw.about) || null,
        // The provider nests these under statistics.network rather than at the top level.
        connections: network.connections_count == null ? null : num(network.connections_count),
        followers: network.followers_count == null ? null : num(network.followers_count),
        department: departmentLabels(ai.department),
        enrichedAt: text(ai.enrichedAt) || null,

        // Their company, as the enrichment describes it.
        companyProfile: {
          name: text(summary.name) || text(company.name) || null,
          website: urlOrNull(links.website ?? raw.company_url),
          industry: text(summary.industry) || text(company.industry) || null,
          size: companySize(summary),
          founded: text(summary.founded_year) || null,
          location: locationLabel(asRecord(company.location).headquarter ?? company.location ?? summary.location),
          description: text(summary.description) || null,
          linkedin: urlOrNull(links.linkedin),
          logo: text(ai.companyPhotoSource) || text(ai.companyPhotoUrl) || null,
        },

        // History. The provider groups roles by employer under `positionGroups`, and spells education
        // `educations`. Entries that carry nothing readable are dropped rather than rendered blank.
        experience: list(ai.positionGroups).map(positionGroup).filter(Boolean),
        education: list(ai.educations).map(school).filter(Boolean),
        skills: list(ai.skills).map(text).filter(Boolean).slice(0, 40),
        languages: list(ai.languages).map(text).filter(Boolean).slice(0, 20),
        certifications: list(ai.certifications).map(text).filter(Boolean).slice(0, 20),
        tags: list(raw.tags).map(text).filter(Boolean).slice(0, 30),

        // Reply Radar's own view of them.
        icpScore: radar.icp_score == null ? null : num(radar.icp_score),
        icpReason: text(radar.icp_reason) || null,
        enrichmentStatus: text(radar.enrichment_status) || null,
        enriched: Object.keys(ai).length > 0,
        campaignNames: list(rollup.campaign_names).map(text).filter(Boolean),
        senderNames: list(rollup.sender_names).map(text).filter(Boolean),
      },
      threads,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "That lead did not load." },
      { status: 502 },
    );
  }
}
