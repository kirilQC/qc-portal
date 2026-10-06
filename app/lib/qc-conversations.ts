// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * Which of a client's conversations are QC's work.
 *
 * Some clients' HeyReach keys are their own account, where their team runs campaigns of its own, and
 * every reply to those lands in the same tables as ours. CAMB had 29 stored conversations and not one
 * from a QC campaign; Willow had 168 of its own beside 433 of ours. A client portal that says "QC reached
 * these people for you" must count only QC's campaigns, so every conversation-based figure — the inbox,
 * reply counts, the feed, the charts, the lead database — is read through this.
 *
 * "Ours" is QC Command's rule, copied verbatim into shared/campaign-code.mjs: the campaign's name carries
 * a QC code (EM031v2, MS-12a) or says "x QC". A conversation is ours when any of its messages names such a
 * campaign. One with no campaign at all is not ours either (it was already hidden from the inbox).
 *
 * Cached per workspace for a minute, because a page load asks for it from several routes at once.
 */
import type { Session } from "./session";
import { scopedByConversation, scopedRows, str } from "./db";
import { isOurCampaign } from "../../shared/campaign-code.mjs";

export type QcConversations = {
  /** Conversation ids that belong to a QC campaign. */
  ids: Set<string>;
  /** The leads behind those conversations. */
  leadIds: Set<string>;
};

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: Promise<QcConversations> }>();

export function qcConversations(session: Session, workspaceId: string): Promise<QcConversations> {
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = load(session, workspaceId);
  // A failed read is not cached, so the next request tries again instead of serving the failure.
  value.catch(() => cache.delete(workspaceId));
  if (cache.size > 200) cache.clear();
  cache.set(workspaceId, { at: Date.now(), value });
  return value;
}

async function load(session: Session, workspaceId: string): Promise<QcConversations> {
  const conversations = await scopedRows(session, "rr_conversations", { select: "id,lead_id", limit: "10000" }, workspaceId);
  const ids = conversations.map((row) => str(row.id)).filter(Boolean);
  const named = ids.length
    ? await scopedByConversation(
        session,
        "rr_messages",
        ids,
        {
          select: "conversation_id,campaign:raw_data->reply_radar->campaign->>name",
          "raw_data->reply_radar->campaign->>name": "not.is.null",
          limit: "5000",
        },
        workspaceId,
      )
    : [];
  const ours = new Set(named.filter((row) => isOurCampaign(str(row.campaign))).map((row) => str(row.conversation_id)));
  const leadIds = new Set(
    conversations.filter((row) => ours.has(str(row.id))).map((row) => str(row.lead_id)).filter(Boolean),
  );
  return { ids: ours, leadIds };
}
