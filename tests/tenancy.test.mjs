// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * The cross-client blob filter.
 *
 * The fixture is the leak as it was reported: Arcjet's lead database showing Noam Brosh with campaigns
 * "AJ004: Post BH'26 Campaign; CT049: BH 2026 Attendees" and a sender list drawn from three different
 * clients. The row was scoped correctly — the row genuinely is Arcjet's — but Reply Radar stamps every
 * lead with an attribution per conversation across every client that ever prospected that person, and
 * rolls them up into campaign, sender and client names.
 *
 * These tests are written as leak tests rather than as behaviour tests. Most of them assert that a
 * string belonging to another client appears nowhere in the serialised output, because the failure this
 * guards against is not "the wrong value renders" but "somebody else's value renders and looks
 * plausible".
 */
import assert from "node:assert/strict";
import test from "node:test";
import { scopeRawData, scopeRows } from "../shared/tenancy.mjs";

const ARCJET = "11111111-1111-1111-1111-111111111111";
const COTOOL = "22222222-2222-2222-2222-222222222222";
const WIZ = "33333333-3333-3333-3333-333333333333";

/** Noam Brosh as Reply Radar actually stores him: one person, three clients prospecting him. */
const NOAM = {
  full_name: "Noam Brosh",
  company_name: "UVeye",
  // The importer copies the rollup to the top level as well as inside reply_radar. Missing this copy
  // would leave the leak in place while looking fixed.
  client_names: "Arcjet; Cotool; Wiz",
  client_count: 3,
  campaign_names: "AJ004: Post BH'26 Campaign; CT049: BH 2026 Attendees; WZ012: Cloud Sec",
  sender_names: "David Mytton; Max Pollard; Roi Galipapa; Eyal Ezra",
  conversation_count: 3,
  reply_radar: {
    enrichment_status: "enriched",
    attributions: [
      { workspaceId: ARCJET, workspaceName: "Arcjet", conversationId: "c-a1", campaignId: "aj004", campaignName: "AJ004: Post BH'26 Campaign", senderId: "s1", senderName: "David Mytton" },
      { workspaceId: COTOOL, workspaceName: "Cotool", conversationId: "c-c1", campaignId: "ct049", campaignName: "CT049: BH 2026 Attendees", senderId: "s2", senderName: "Max Pollard" },
      { workspaceId: COTOOL, workspaceName: "Cotool", conversationId: "c-c2", campaignId: "ct049", campaignName: "CT049: BH 2026 Attendees", senderId: "s3", senderName: "Roi Galipapa" },
      { workspaceId: WIZ, workspaceName: "Wiz", conversationId: "c-w1", campaignId: "wz012", campaignName: "WZ012: Cloud Sec", senderId: "s4", senderName: "Eyal Ezra" },
    ],
    rollup: {
      clients: ["Arcjet", "Cotool", "Wiz"],
      campaigns: ["AJ004: Post BH'26 Campaign", "CT049: BH 2026 Attendees", "WZ012: Cloud Sec"],
      senders: ["David Mytton", "Max Pollard", "Roi Galipapa", "Eyal Ezra"],
      client_count: 3,
      campaign_count: 3,
      client_names: "Arcjet; Cotool; Wiz",
      campaign_names: "AJ004: Post BH'26 Campaign; CT049: BH 2026 Attendees; WZ012: Cloud Sec",
      sender_names: "David Mytton; Max Pollard; Roi Galipapa; Eyal Ezra",
      conversation_count: 3,
    },
  },
};

/** Every string in the output, for asserting that a foreign name appears nowhere at all. */
const dump = (value) => JSON.stringify(value);

const FOREIGN = ["Cotool", "Wiz", "CT049", "WZ012", "Max Pollard", "Roi Galipapa", "Eyal Ezra", COTOOL, WIZ];

test("no other client's name survives anywhere in the row", () => {
  const scoped = scopeRawData(NOAM, ARCJET);
  const serialised = dump(scoped);
  for (const needle of FOREIGN) {
    assert.ok(!serialised.includes(needle), `"${needle}" leaked into Arcjet's copy of this lead`);
  }
});

test("this client's own facts are kept, not thrown away with the rest", () => {
  // Blanking the columns would be safe and useless — the page is meant to show them.
  const { reply_radar: radar } = scopeRawData(NOAM, ARCJET);
  assert.equal(radar.rollup.campaign_names, "AJ004: Post BH'26 Campaign");
  assert.equal(radar.rollup.sender_names, "David Mytton");
  assert.equal(radar.rollup.campaign_count, 1);
  assert.equal(radar.rollup.conversation_count, 1);
  assert.equal(radar.attributions.length, 1);
  assert.equal(radar.attributions[0].workspaceId, ARCJET);
});

test("the copy of the rollup at the top of raw_data is rewritten too", () => {
  // The leak would have looked fixed while the top-level keys still named three clients.
  const scoped = scopeRawData(NOAM, ARCJET);
  assert.equal(scoped.campaign_names, "AJ004: Post BH'26 Campaign");
  assert.equal(scoped.sender_names, "David Mytton");
  assert.equal(scoped.conversation_count, 1);
});

test("client_names and client_count are removed rather than recomputed", () => {
  // Within one client, "which other clients are working this lead" is not a question to answer at all.
  const scoped = scopeRawData(NOAM, ARCJET);
  assert.ok(!("client_names" in scoped));
  assert.ok(!("client_count" in scoped));
  assert.ok(!("client_names" in scoped.reply_radar.rollup));
  assert.ok(!("clients" in scoped.reply_radar.rollup));
});

test("two conversations under one campaign count once for the campaign, twice for conversations", () => {
  const scoped = scopeRawData(NOAM, COTOOL);
  assert.equal(scoped.reply_radar.rollup.campaign_names, "CT049: BH 2026 Attendees");
  assert.equal(scoped.reply_radar.rollup.campaign_count, 1);
  assert.equal(scoped.reply_radar.rollup.conversation_count, 2);
  assert.equal(scoped.reply_radar.rollup.sender_names, "Max Pollard; Roi Galipapa");
});

test("a workspace with no attribution on this lead gets nothing, not everything", () => {
  const scoped = scopeRawData(NOAM, "44444444-4444-4444-4444-444444444444");
  assert.equal(scoped.reply_radar.rollup.campaign_names, "");
  assert.equal(scoped.reply_radar.attributions.length, 0);
  for (const needle of FOREIGN) assert.ok(!dump(scoped).includes(needle));
});

test("no workspace in play keeps nothing", () => {
  // The case that decides whether a mistake elsewhere becomes a disclosure. An empty column is a
  // visible absence somebody reports; another client's campaign names are a leak nobody notices.
  for (const missing of [null, undefined, ""]) {
    const scoped = scopeRawData(NOAM, missing);
    assert.equal(scoped.reply_radar.attributions.length, 0, `a ${String(missing)} workspace kept attributions`);
    for (const needle of FOREIGN) {
      assert.ok(!dump(scoped).includes(needle), `"${needle}" survived a ${String(missing)} workspace`);
    }
  }
});

test("enrichment and the lead's own fields are untouched", () => {
  // The filter must not become a reason for the rest of the page to go blank.
  const scoped = scopeRawData(NOAM, ARCJET);
  assert.equal(scoped.full_name, "Noam Brosh");
  assert.equal(scoped.company_name, "UVeye");
  assert.equal(scoped.reply_radar.enrichment_status, "enriched");
});

test("the input is never mutated", () => {
  // These objects come straight off a parsed response and a caller may hold another reference.
  const before = dump(NOAM);
  scopeRawData(NOAM, ARCJET);
  assert.equal(dump(NOAM), before);
});

test("a row with no attributions still loses the flattened copies", () => {
  const thin = { full_name: "Someone", client_names: "Arcjet; Cotool", campaign_names: "AJ001; CT002" };
  const scoped = scopeRawData(thin, ARCJET);
  assert.ok(!("client_names" in scoped));
  assert.ok(!("campaign_names" in scoped), "a flattened rollup survived with no attributions to rebuild it from");
  assert.equal(scoped.full_name, "Someone");
});

test("values that are not objects pass through untouched", () => {
  for (const value of [null, undefined, "text", 7, []]) {
    assert.deepEqual(scopeRawData(value, ARCJET), value);
  }
});

/* ── Whole result sets ──────────────────────────────────────────────────────────────────────── */

test("every row in a result set is scoped, and rows without raw_data pass through", () => {
  const rows = [
    { id: "1", name: "Noam Brosh", raw_data: NOAM },
    { id: "2", name: "Someone Else" },
    { id: "3", name: "Third", raw_data: { reply_radar: { attributions: [] } } },
  ];
  const scoped = scopeRows(rows, ARCJET);
  assert.equal(scoped.length, 3);
  assert.equal(scoped[1].name, "Someone Else");
  for (const needle of FOREIGN) {
    assert.ok(!dump(scoped).includes(needle), `"${needle}" survived in a result set`);
  }
});

test("a non-array is handed back as it came", () => {
  assert.equal(scopeRows(null, ARCJET), null);
  assert.equal(scopeRows(undefined, ARCJET), undefined);
});
