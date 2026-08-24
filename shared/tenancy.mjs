// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * Cutting one client's facts out of a row that belongs to them.
 *
 * ── The leak this exists to close ───────────────────────────────────────────────────────────────
 * QC works several clients that prospect the same people, and Reply Radar records that on purpose.
 * Every lead carries `raw_data.reply_radar.attributions`: one entry per conversation, each stamped with
 * the workspace, campaign and sender it came from — *across every client that touched that person*. It
 * then flattens all of them into a `rollup` holding `campaign_names`, `sender_names` and `client_names`,
 * which is exactly the cross-client picture QC wants internally.
 *
 * In the portal it is a disclosure. Arcjet's lead database was showing Noam Brosh with campaigns
 * "AJ004: Post BH'26 Campaign; CT049: BH 2026 Attendees" and a sender list drawn from three different
 * clients — naming Cotool's campaigns, Cotool's people, and by implication that Cotool is prospecting
 * the same person. The row was scoped correctly. Its contents were not.
 *
 * ── Why it is filtered here rather than in the routes ───────────────────────────────────────────
 * Three routes read the rollup and every one of them would have needed the same filter, correctly, for
 * ever. That is the arrangement `db.ts` exists to refuse: tenancy that depends on each caller
 * remembering. So this runs inside `scopedRows`, on every row of every table, and a route cannot opt
 * out of it or forget it. A new screen written next year gets it without knowing it exists.
 *
 * ── Why the rollup is recomputed rather than deleted ────────────────────────────────────────────
 * Deleting it would blank the campaign and sender columns on a screen that is meant to show them. The
 * numbers are real, they were just totalled over the wrong set — so the attributions are filtered to
 * the one workspace and the rollup is recomputed from what survives. `client_names` and `client_count`
 * are dropped outright: within one client those are answers to a question nobody in that client is
 * entitled to ask.
 */

/** Present-and-non-empty string, or "". */
const text = (value) => (typeof value === "string" ? value.trim() : "");
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * Recompute a rollup over one workspace's attributions.
 *
 * Deliberately the same shape Reply Radar writes — the same keys, the same `"; "` joins — so the readers
 * downstream keep working unchanged and there is one fewer thing to keep in step. `clients`,
 * `client_names` and `client_count` are the exception and are simply not produced.
 */
function rollupOf(rows) {
  const unique = (key) => [...new Set(rows.map((row) => text(row[key])).filter(Boolean))];
  const campaigns = unique("campaignName");
  const senders = unique("senderName");
  return {
    campaigns,
    senders,
    campaign_count: campaigns.length,
    campaign_names: campaigns.join("; "),
    sender_names: senders.join("; "),
    conversation_count: new Set(rows.map((row) => text(row.conversationId)).filter(Boolean)).size,
  };
}

/**
 * A lead's `raw_data`, reduced to one workspace.
 *
 * Returns the value unchanged when there is nothing to scope — a row with no attributions, or a call
 * with no workspace in play. Never mutates its input: these objects come straight off a parsed response
 * and a caller may hold another reference to them.
 *
 * @param {unknown} raw          the row's `raw_data`
 * @param {string|null} workspaceId  the only workspace whose facts may survive
 */
export function scopeRawData(raw, workspaceId) {
  if (!isObject(raw)) return raw;

  const wanted = text(workspaceId);
  const radar = isObject(raw.reply_radar) ? raw.reply_radar : null;
  const attributions = radar && Array.isArray(radar.attributions) ? radar.attributions : null;

  // No attributions means no cross-client blob to cut — but the flattened copies at the top level are
  // written from one, so they still have to go.
  if (!attributions) return stripTopLevel(raw, null);

  /*
   * With no workspace in play, keep nothing rather than everything.
   *
   * This is the case that decides whether a mistake elsewhere becomes a disclosure. A caller that
   * reaches here without a workspace has already lost track of who it is reading for, and the safe
   * answer to "whose campaigns are these" is then "none of them" — an empty column is a visible
   * absence somebody reports, where another client's campaign names are a leak nobody notices.
   */
  const mine = wanted
    ? attributions.filter((row) => isObject(row) && text(row.workspaceId) === wanted)
    : [];

  const rollup = rollupOf(mine.map((row) => (isObject(row) ? row : {})));
  const scopedRadar = { ...radar, attributions: mine, rollup };
  // Written by the same importer alongside the rollup, and just as cross-client.
  delete scopedRadar.client_names;
  delete scopedRadar.client_count;

  return stripTopLevel({ ...raw, reply_radar: scopedRadar }, rollup);
}

/**
 * The importer also copies the rollup onto the top of `raw_data`, outside `reply_radar`.
 *
 * Missing that copy would have left the leak in place while looking fixed, which is the worst possible
 * outcome for this kind of change — so the top-level keys are rewritten from the scoped rollup, and the
 * two that name other clients are removed rather than recomputed.
 */
function stripTopLevel(raw, rollup) {
  const out = { ...raw };
  delete out.client_names;
  delete out.client_count;
  if (rollup) {
    out.campaign_names = rollup.campaign_names;
    out.sender_names = rollup.sender_names;
    out.campaign_count = rollup.campaign_count;
    out.conversation_count = rollup.conversation_count;
  } else {
    delete out.campaign_names;
    delete out.sender_names;
    delete out.campaign_count;
    delete out.conversation_count;
  }
  return out;
}

/**
 * Scope every `raw_data` in a result set.
 *
 * Rows without one pass straight through, which is most tables — this only costs anything on the two
 * that carry a lead blob.
 */
export function scopeRows(rows, workspaceId) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) =>
    isObject(row) && "raw_data" in row ? { ...row, raw_data: scopeRawData(row.raw_data, workspaceId) } : row,
  );
}
