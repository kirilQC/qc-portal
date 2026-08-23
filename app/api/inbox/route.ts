// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * The inbox: every conversation for one client, with its full thread.
 *
 * ── Read-only, deliberately ─────────────────────────────────────────────────────────────────────
 * Reply Radar's inbox can send a reply through HeyReach. This one cannot, and the omission is the
 * point rather than an unfinished edge: a message sent from here would go out under a QC sender's
 * name, to a real person, on the client's behalf. That is a consequential outward action, and it needs
 * to be decided deliberately rather than inherited by copying a screen. So the composer here shows the
 * draft that already exists and has no send button and no regenerate — regenerating also spends money
 * and writes to the database, neither of which a viewing surface should do as a side effect.
 *
 * ── Where the shapes come from ──────────────────────────────────────────────────────────────────
 * The field names mirror Reply Radar's `/api/inbox` so the page component is a near-copy rather than a
 * translation: same `Lead` shape, same `messages` array, same score/tier/sentiment vocabulary. Where
 * Reply Radar computes something (tier bands, reply counts), it is computed the same way here.
 */
import { NextResponse } from "next/server";
import { resolveScope } from "../../lib/auth-context";
import { num, scopedByConversation, scopedRows, str, type Row } from "../../lib/db";
import type { Session } from "../../lib/session";

export const maxDuration = 60;

/** How many conversations one request will assemble. The page pages through with "See 10 more". */
const LIMIT = 300;

type Message = { id: string; body: string; direction: string; sentAt: string; authorName: string };

/** Reply Radar's own bands, reproduced so a score reads identically in both tools. */
const tierFor = (score: number): "hot" | "warm" | "nurture" => {
  if (score >= 75) return "hot";
  if (score >= 50) return "warm";
  return "nurture";
};

/** "3h", "2d" — the age column. */
function ageLabel(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

/** Reads a nested value out of a lead's `raw_data`, which is where Reply Radar keeps its own fields. */
function radar(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const reply = (raw as Record<string, unknown>).reply_radar;
  return reply && typeof reply === "object" ? (reply as Record<string, unknown>) : {};
}

async function buildInbox(session: Session, workspaceId: string) {
  // Conversations first — they carry the score, tier and the workspace tenancy that everything else
  // is proved against.
  const conversations = await scopedRows(
    session,
    "rr_conversations",
    {
      select: "id,lead_id,heyreach_conversation_id,score,tier,score_reason,last_message_at,last_message_direction,last_refreshed_at",
      order: "last_message_at.desc",
      limit: String(LIMIT),
    },
    workspaceId,
  );
  if (!conversations.length) return [];

  const leadIds = [...new Set(conversations.map((row) => str(row.lead_id)).filter(Boolean))];
  const conversationIds = conversations.map((row) => str(row.id)).filter(Boolean);

  const [leads, messages] = await Promise.all([
    leadIds.length
      ? scopedRows(
          session,
          "rr_leads",
          {
            // Only the columns the original CREATE TABLE defines. Reply Radar's schema.sql documents a
            // set of generated columns (icp_score, campaign_names, …) that were never added to the live
            // table — `create table if not exists` does not patch an existing one — so asking for them
            // is a 400. Everything they would have held is derived from raw_data below instead, which
            // is where the importer actually writes it.
            select: "id,name,role,company,linkedin_profile_url,linkedin_id,raw_data",
            id: `in.(${leadIds.join(",")})`,
            limit: String(leadIds.length),
          },
          workspaceId,
        )
      : Promise.resolve([] as Row[]),
    // Messages hang off conversations and have no workspace of their own, so they go through the path
    // that proves ownership of every id before reading a single row.
    scopedByConversation(
      session,
      "rr_messages",
      conversationIds,
      { select: "id,conversation_id,direction,body,sent_at,raw_data", order: "sent_at.asc", limit: "8000" },
      workspaceId,
    ),
  ]);

  const leadById = new Map(leads.map((row) => [str(row.id), row]));

  /** Messages grouped by conversation, in the order they were sent. */
  const threadByConversation = new Map<string, Message[]>();
  /** The newest inbound message per conversation — where Reply Radar caches its draft and sentiment. */
  const latestInbound = new Map<string, Row>();

  for (const row of messages) {
    const key = str(row.conversation_id);
    const direction = str(row.direction) === "outbound" ? "outbound" : "inbound";
    const senderName = str((radar(row.raw_data).sender as Record<string, unknown>)?.name ?? "");
    const lead = leadById.get(str(conversations.find((c) => str(c.id) === key)?.lead_id ?? ""));

    const message: Message = {
      id: str(row.id),
      body: str(row.body),
      direction,
      sentAt: str(row.sent_at),
      authorName: direction === "outbound" ? senderName || "QC" : str(lead?.name) || "Them",
    };
    const list = threadByConversation.get(key);
    if (list) list.push(message);
    else threadByConversation.set(key, [message]);

    if (direction === "inbound") latestInbound.set(key, row);
  }

  return conversations
    .map((row) => {
      const id = str(row.id);
      const lead = leadById.get(str(row.lead_id));
      // Reply Radar drops conversations whose lead row is gone as orphaned, and so does this — a row
      // with no person attached is a row nobody can act on.
      if (!lead) return null;

      const thread = threadByConversation.get(id) ?? [];
      const inbound = latestInbound.get(id);
      const cached = radar(inbound?.raw_data);
      const leadRadar = radar(lead.raw_data);
      const enrichment = (leadRadar.ai_ark ?? {}) as Record<string, unknown>;

      const name = str(lead.name) || "Unnamed";
      const score = num(row.score);
      const lastMessageAt = str(row.last_message_at);

      /** The rollup the importer writes onto raw_data, in place of the generated columns. */
      const rollup = (leadRadar.rollup ?? {}) as Record<string, unknown>;
      const asList = (value: unknown): string[] => {
        if (Array.isArray(value)) return value.map((item) => str(item)).filter(Boolean);
        return typeof value === "string" && value.trim()
          ? value.split(";").map((part) => part.trim()).filter(Boolean)
          : [];
      };

      return {
        id,
        leadId: str(lead.id),
        initials: initialsOf(name),
        name,
        role: str(lead.role) || str(enrichment.title),
        company: str(lead.company),
        profileUrl: lead.linkedin_profile_url ? str(lead.linkedin_profile_url) : null,
        photoUrl: enrichment.profilePhotoSource ? str(enrichment.profilePhotoSource) : null,
        companyPhotoUrl: enrichment.companyPhotoSource ? str(enrichment.companyPhotoSource) : null,
        headline: enrichment.headline ? str(enrichment.headline) : null,
        industry: enrichment.industry ? str(enrichment.industry) : null,
        enriched: Object.keys(enrichment).length > 0,

        campaignName:
          asList(rollup.campaign_names)[0] ??
          str((leadRadar.campaign as Record<string, unknown>)?.name) ??
          null,
        senderName: asList(rollup.sender_names)[0] || "Unknown sender",

        // The number in the LEAD SCORE column is the ICP score, exactly as Reply Radar shows it.
        leadScore: leadRadar.icp_score == null ? null : num(leadRadar.icp_score),
        icpReason: leadRadar.icp_reason ? str(leadRadar.icp_reason) : null,

        score,
        tier: (str(row.tier) as "hot" | "warm" | "nurture") || tierFor(score),
        reason: str(row.score_reason),
        sentiment: cached.sentiment ? str(cached.sentiment) : null,
        cachedDraft: cached.cached_draft ? str(cached.cached_draft) : null,
        cachedReason: cached.cached_reason ? str(cached.cached_reason) : null,
        analyzedAt: cached.analyzed_at ? str(cached.analyzed_at) : null,

        preview: thread.at(-1)?.body ?? "",
        age: ageLabel(lastMessageAt),
        lastMessageAt,
        latestReplyAt: lastMessageAt,
        lastRefreshedAt: row.last_refreshed_at ? str(row.last_refreshed_at) : null,
        replies: thread.filter((message) => message.direction === "inbound").length,
        messages: thread,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
}

export async function GET(request: Request) {
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
    const conversations = await buildInbox(session, workspaceId);
    return NextResponse.json({ ok: true, conversations });
  } catch (error) {
    return NextResponse.json(
      { ok: false, conversations: [], error: error instanceof Error ? error.message : "The inbox did not load." },
      { status: 502 },
    );
  }
}
