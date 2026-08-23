// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * The lead database for one client.
 *
 * Reads `rr_lead_index` rather than `rr_leads` — the view Reply Radar built for exactly this screen,
 * which carries `last_reply_at` and `reply_count` rolled up from the conversation and message tables.
 * Sorting "newest first" against the base table would sort by when a row was inserted, which is a fact
 * about the importer rather than about the lead.
 *
 * Pagination is a plain offset. A keyset cursor would be better under load, but the filters here are
 * user-chosen and change the ordering, and an offset that is honest about being an offset beats a
 * cursor that silently skips rows when the sort changes underneath it.
 */
import { NextResponse } from "next/server";
import { resolveScope } from "../../lib/auth-context";
import { num, scopedCount, scopedRows, str } from "../../lib/db";

export const maxDuration = 60;

/** The sorts Reply Radar offers, with the same labels, mapped to PostgREST ordering. */
const SORTS: Record<string, string> = {
  recent: "last_reply_at.desc.nullslast,created_at.desc",
  oldest: "last_reply_at.asc.nullsfirst,created_at.asc",
  "added-desc": "created_at.desc",
  "added-asc": "created_at.asc",
  "replies-desc": "reply_count.desc.nullslast,created_at.desc",
  "replies-asc": "reply_count.asc.nullsfirst,created_at.desc",
  "name-asc": "name.asc.nullslast,created_at.desc",
  "name-desc": "name.desc.nullslast,created_at.desc",
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("client");

  let scope;
  try {
    scope = await resolveScope(slug);
  } catch {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }
  const { session, workspaceId } = scope;
  if (!workspaceId) return NextResponse.json({ ok: false, error: "Pick a client first." }, { status: 400 });

  const search = url.searchParams.get("search")?.trim() ?? "";
  const sort = SORTS[url.searchParams.get("sort") ?? "recent"] ?? SORTS.recent;
  const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit")) || 50));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);

  const params: Record<string, string> = {
    // Base columns plus the two the view adds. The generated columns Reply Radar's schema.sql documents
    // (icp_score, ai_title, campaign_names, …) do not exist on the live table — `create table if not
    // exists` never patched it — so everything they would have carried is read out of raw_data below.
    select: "id,name,role,company,linkedin_profile_url,linkedin_id,created_at,last_reply_at,reply_count,raw_data",
    order: sort,
    limit: String(limit),
    offset: String(offset),
  };
  // PostgREST's `or=` with ilike, the same shape Reply Radar uses for its search box. The needle is
  // stripped of the characters that would otherwise terminate the filter expression and let a crafted
  // search string alter the query around it.
  if (search) {
    const needle = search.replace(/[(),*]/g, " ").trim();
    if (needle) {
      params.or = `(name.ilike.*${needle}*,company.ilike.*${needle}*,role.ilike.*${needle}*,linkedin_id.ilike.*${needle}*)`;
    }
  }

  try {
    // The page count and the client's actual total, fetched together — the header count costs nothing
    // extra and is what the subheading should say.
    const [rows, total] = await Promise.all([
      scopedRows(session, "rr_lead_index", params, workspaceId),
      scopedCount(session, "rr_lead_index", params.or ? { or: params.or } : {}, workspaceId),
    ]);

    const asList = (value: unknown): string[] => {
      if (Array.isArray(value)) return value.map((item) => str(item)).filter(Boolean);
      return typeof value === "string" && value.trim()
        ? value.split(";").map((part) => part.trim()).filter(Boolean)
        : [];
    };

    const leads = rows.map((row) => {
      const raw = (row.raw_data ?? {}) as Record<string, unknown>;
      const radar = (raw.reply_radar ?? {}) as Record<string, unknown>;
      const enrichment = (radar.ai_ark ?? {}) as Record<string, unknown>;
      const rollup = (radar.rollup ?? {}) as Record<string, unknown>;
      const enrichedCompany = (enrichment.company ?? {}) as Record<string, unknown>;
      const companySummary = (enrichedCompany.summary ?? {}) as Record<string, unknown>;
      return {
        id: str(row.id),
        name: str(row.name) || "Unnamed",
        role: str(row.role) || str(enrichment.title),
        company: str(row.company) || str(companySummary.name),
        linkedinId: row.linkedin_id ? str(row.linkedin_id) : null,
        profileUrl: row.linkedin_profile_url ? str(row.linkedin_profile_url) : null,
        photoUrl: enrichment.profilePhotoSource ? str(enrichment.profilePhotoSource) : null,
        email: str(raw.email_address ?? raw.custom_email ?? raw.enriched_email) || null,
        location: enrichment.location ? str(enrichment.location) : null,
        headline: enrichment.headline ? str(enrichment.headline) : null,
        industry: enrichment.industry ? str(enrichment.industry) : null,
        campaignNames: asList(rollup.campaign_names),
        senderNames: asList(rollup.sender_names),
        icpScore: radar.icp_score == null ? null : num(radar.icp_score),
        icpReason: radar.icp_reason ? str(radar.icp_reason) : null,
        enrichmentStatus: radar.enrichment_status ? str(radar.enrichment_status) : null,
        enriched: Object.keys(enrichment).length > 0,
        conversationCount: num(rollup.conversation_count),
        replyCount: num(row.reply_count),
        lastReplyAt: row.last_reply_at ? str(row.last_reply_at) : null,
        createdAt: str(row.created_at),
      };
    });

    return NextResponse.json({
      ok: true,
      leads,
      total,
      // One more than asked for would have been cleaner, but PostgREST has already applied the limit —
      // a full page is therefore the signal that another may exist.
      hasMore: leads.length === limit,
      nextOffset: offset + leads.length,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, leads: [], error: error instanceof Error ? error.message : "The database did not load." },
      { status: 502 },
    );
  }
}
