// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * Sending one reply to one lead, on LinkedIn, through HeyReach — the same path Reply Radar uses, scoped
 * to the portal session.
 *
 * ── What has to be true before a message leaves ─────────────────────────────────────────────────
 * 1. A real intent: the request carries `confirm: "send"`, a literal the UI only sets on the confirm
 *    press, so a stray call or a form default cannot send.
 * 2. The conversation belongs to this session's client. It is read through the scoped path, so a client
 *    can only ever send within their own inbox — there is no id they can pass to reach another client's.
 * 3. Nothing identical has just gone out. The same body, outbound, on the same conversation, inside a
 *    day, is refused — the guard against a double-tap or a retry sending the message twice.
 *
 * The sent message is written to our own `rr_messages` immediately (HeyReach only reports it back
 * minutes later), with the synthetic id ingestion would mint, so it merges rather than duplicating on
 * the next refresh.
 */
import { NextResponse } from "next/server";
import { currentSession, resolveScope } from "../../../lib/auth-context";
import { adminWrite, scopedByConversation, scopedRows, str } from "../../../lib/db";
import { syntheticMessageId } from "../../../../shared/message-identity.mjs";

export const maxDuration = 30;

const HEYREACH_BASE = (process.env.HEYREACH_API_BASE ?? "https://api.heyreach.io/api/public").replace(/\/$/, "");
/** LinkedIn direct messages carry no subject; HeyReach wants the field regardless. */
const SUBJECT = "";
/** A day: the same sentence to the same person twice is never intended. */
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The real HeyReach chatroom id out of the one we store — the part before the first "::". */
const chatroomId = (stored: unknown) => {
  const value = str(stored);
  const cut = value.indexOf("::");
  return cut === -1 ? value : value.slice(0, cut);
};

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const conversationId = str(body.conversationId);
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const slug = typeof body.client === "string" ? body.client : null;

  if (body.confirm !== "send") {
    return NextResponse.json({ ok: false, error: "A reply is only sent when you press send." }, { status: 400 });
  }
  if (!conversationId) return NextResponse.json({ ok: false, error: "No conversation was named." }, { status: 400 });
  if (!message) return NextResponse.json({ ok: false, error: "There is nothing written to send." }, { status: 400 });

  try {
    const { session: scoped, workspaceId } = await resolveScope(slug);
    if (!workspaceId) return NextResponse.json({ ok: false, error: "Pick a client first." }, { status: 400 });

    // Scoped read — proves the conversation is this client's and hands back the ids the send needs.
    const conversations = await scopedRows(
      scoped,
      "rr_conversations",
      { select: "id,heyreach_conversation_id,account_id", id: `eq.${conversationId}`, limit: "1" },
      workspaceId,
    );
    const conversation = conversations[0];
    if (!conversation) return NextResponse.json({ ok: false, error: "That conversation is not in this inbox." }, { status: 404 });

    const heyreachConversationId = chatroomId(conversation.heyreach_conversation_id);
    const accountId = str(conversation.account_id);
    if (!heyreachConversationId || !accountId) {
      return NextResponse.json(
        { ok: false, error: "This conversation is not linked to a HeyReach chatroom and sender, so nothing can be sent from it." },
        { status: 409 },
      );
    }

    // Duplicate guard, before the API key is even read — a duplicate is refused whether or not HeyReach
    // is reachable, and reaching it is the step that cannot be undone.
    const since = Date.now() - DUPLICATE_WINDOW_MS;
    const recent = await scopedByConversation(
      scoped,
      "rr_messages",
      [conversationId],
      { select: "id,body,sent_at", direction: "eq.outbound", order: "sent_at.desc", limit: "50" },
      workspaceId,
    ).catch(() => []);
    if (recent.some((row) => str(row.body) === message && Date.parse(str(row.sent_at)) >= since)) {
      return NextResponse.json(
        { ok: false, error: "That exact message has already been sent to this lead in the last day." },
        { status: 409 },
      );
    }

    const workspaces = await scopedRows(scoped, "rr_workspaces", { select: "name,heyreach_api_key_ciphertext", limit: "1" }, workspaceId);
    const apiKey = str(workspaces[0]?.heyreach_api_key_ciphertext);
    if (!apiKey) return NextResponse.json({ ok: false, error: "This client has no HeyReach API key configured." }, { status: 409 });

    const response = await fetch(`${HEYREACH_BASE}/inbox/SendMessage`, {
      method: "POST",
      headers: { "X-API-KEY": apiKey, accept: "application/json", "content-type": "application/json" },
      // Word for word — no template, no signature, no trailing space.
      body: JSON.stringify({
        conversationId: heyreachConversationId,
        linkedInAccountId: /^\d+$/.test(accountId) ? Number(accountId) : accountId,
        message,
        subject: SUBJECT,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return NextResponse.json(
        { ok: false, error: `HeyReach did not send the message (${response.status}). ${detail.slice(0, 300)}`.trim() },
        { status: 502 },
      );
    }

    const now = new Date().toISOString();
    // Written to our own table now; the synthetic id makes HeyReach's later copy merge onto this row.
    await adminWrite(
      "rr_messages",
      "POST",
      [
        {
          conversation_id: conversationId,
          heyreach_message_id: syntheticMessageId(now, message),
          direction: "outbound",
          body: message,
          sent_at: now,
          raw_data: { reply_radar: { source: "qc_portal_send", sent_at: now } },
        },
      ],
      { on_conflict: "conversation_id,heyreach_message_id" },
      ["resolution=merge-duplicates", "return=minimal"],
    );
    await adminWrite(
      "rr_conversations",
      "PATCH",
      { last_message_at: now, last_message_direction: "outbound" },
      { id: `eq.${conversationId}` },
      ["return=minimal"],
    ).catch(() => null);

    return NextResponse.json({ ok: true, sentAt: now, message });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "That reply could not be sent." },
      { status: 502 },
    );
  }
}
