// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * The weekly call parser, tested against a document in the shape Reply Radar writes.
 *
 * The fixture below is Steadywell's 20 August call: real frontmatter, real attendees, and the Campaigns
 * and Deals items exactly as they appear on screen. The Action Items and the transcript are written to
 * match the generator's documented format, since that call's recap is the only one in the folder and its
 * action section is not visible in the screenshot I have.
 *
 * The recap is Slack mrkdwn rather than markdown, so the headings are written the way Slack sends them.
 * That is the spelling the parser has to survive; a converted document is tested separately.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  RENDER_ORDER, initialsOf, isHost, parseAttendees, parseCall, parseRecap, plainText,
  resolveEmoji, splitFrontmatter, splitOwner, wordCount,
} from "../shared/calls.mjs";

const CALL = `---
title: "Steadywell <> QC Weekly"
call_date: 2026-08-20
call_id: not_Axi7P84FNb7M5u
posted_to: Internal
attendees: Kiril Ivlev, Kori Bivens, Jake Bivens, Josh Kermisch, Luke Bivens, Tim Raderstorf, Charlie
host: Kiril
duration_min: 30
last_synced: 2026-08-21
---

# Steadywell <> QC Weekly — 2026-08-20

## Recap

*:signal_strength: _Campaigns_ :signal_strength:*
1. Job postings campaign launching this week: 135 ICP-matched companies, ~1,000 contacts
2. ACO pure-prospect campaign launching this week: 92 ACOs, ~240 contacts, non-conference signal
3. NAACOS tier-one list moving to a high-touch, non-automated approach
• Individually crafted short LinkedIn messages, not a bulk sequence

*:moneybag: _Deals_ :moneybag:*
1. Zeal investment committee meeting tomorrow morning, LOI already received
2. Value Care Group (clinically integrated network, Idaho) sent an LOI this week

*:dart: _Action Items_ :dart:*
1. Kori — pull the NAACOS tier-one list into per-org research docs before Monday
2. Tim — introduce the MedVale contact at Value Care Group
3. Kiril — confirm the sender split across both campaigns
• Both launch Thursday, so it has to be set before Wednesday night

*:calendar: _Next Steps_ :calendar:*
1. Review both campaigns' first-week numbers on next week's call

## Transcript

Kiril: Right, let us get started. Kori, do you want to take the campaigns first.
Kori: Sure. So the job postings one is ready to go.
`;

/* ── Frontmatter and people ─────────────────────────────────────────────────────────────────── */

test("frontmatter is metadata, not the first nine lines of the recap", () => {
  const { meta, body } = splitFrontmatter(CALL);
  assert.equal(meta.title, "Steadywell <> QC Weekly");
  assert.equal(meta.call_date, "2026-08-20");
  assert.equal(meta.posted_to, "Internal");
  assert.equal(meta.duration_min, "30");
  assert.ok(!body.includes("call_id"));
  assert.ok(!body.includes("---"));
});

test("attendees become people, and a one-word name still gets an initial", () => {
  const names = parseAttendees("Kiril Ivlev, Kori Bivens, Charlie");
  assert.deepEqual(names, ["Kiril Ivlev", "Kori Bivens", "Charlie"]);
  assert.equal(initialsOf("Kiril Ivlev"), "KI");
  // "Charlie" is really in the attendee list, and a naive two-word split throws on it.
  assert.equal(initialsOf("Charlie"), "C");
  assert.equal(initialsOf(""), "?");
  assert.equal(initialsOf("Mary Jane Watson"), "MW");
});

test("the host is matched on the first name, since the two fields disagree", () => {
  // `host: Kiril` against `attendees: Kiril Ivlev` — an equality check finds nobody.
  assert.equal(isHost("Kiril Ivlev", "Kiril"), true);
  assert.equal(isHost("Kori Bivens", "Kiril"), false);
  assert.equal(isHost("Kiril Ivlev", ""), false);
});

/* ── Slack decoration ───────────────────────────────────────────────────────────────────────── */

test("known shortcodes resolve and unknown ones stay visible", () => {
  assert.equal(resolveEmoji(":dart: go"), "🎯 go");
  // Reported rather than silently dropped, so a renamed emoji is noticed.
  assert.equal(resolveEmoji(":not_a_real_emoji: go"), ":not_a_real_emoji: go");
});

test("slack decoration is stripped rather than rendered as punctuation", () => {
  assert.equal(plainText("*Bold* and _italic_"), "Bold and italic");
  assert.equal(plainText("<@U012ABCDE|Kori> owns it"), "Kori owns it");
  assert.equal(plainText("<https://example.com|the doc>"), "the doc");
  assert.equal(plainText("*:dart: _Action Items_ :dart:*"), "🎯 Action Items 🎯");
});

/* ── The recap ──────────────────────────────────────────────────────────────────────────────── */

test("the recap splits into its typed sections", () => {
  const { sections } = parseRecap(CALL.slice(CALL.indexOf("## Recap")));
  assert.deepEqual(sections.map((s) => s.key), ["campaigns", "deals", "actions", "next"]);
  assert.equal(sections[0].items.length, 3);
  assert.equal(sections[1].items.length, 2);
});

test("a sub-bullet attaches to the item above it rather than becoming an item", () => {
  const { sections } = parseRecap(CALL.slice(CALL.indexOf("## Recap")));
  const campaigns = sections[0];
  assert.equal(campaigns.items.length, 3, "the sub-bullet became a fourth item");
  assert.equal(campaigns.items[2].sub, "Individually crafted short LinkedIn messages, not a bulk sequence");
});

test("a section the call had nothing for is dropped, not shown empty", () => {
  const { sections } = parseRecap("*_Campaigns_*\n1. One thing\n\n*_Discussed_*\n");
  assert.deepEqual(sections.map((s) => s.key), ["campaigns"]);
});

test("a plain heading works as well as the Slack spelling", () => {
  // A document that has been through a converter on the way in must not stop parsing.
  const { sections } = parseRecap("Campaigns\n1. One thing\n\nDeals\n1. Another");
  assert.deepEqual(sections.map((s) => s.key), ["campaigns", "deals"]);
});

test("text before any heading is kept rather than dropped", () => {
  const { intro, sections } = parseRecap("A loose opening line.\n\nCampaigns\n1. One thing");
  assert.equal(intro, "A loose opening line.");
  assert.equal(sections.length, 1);
});

/* ── Owners ─────────────────────────────────────────────────────────────────────────────────── */

test("an action item's owner is pulled off the front of the line", () => {
  assert.deepEqual(splitOwner("Kori — pull the list together"), { owner: "Kori", text: "pull the list together" });
  assert.deepEqual(splitOwner("Kiril Ivlev: confirm the split"), { owner: "Kiril Ivlev", text: "confirm the split" });
  assert.deepEqual(splitOwner("@Tim - make the intro"), { owner: "Tim", text: "make the intro" });
  assert.deepEqual(splitOwner("<@U012ABCDE|Josh> — draft the angle"), { owner: "Josh", text: "draft the angle" });
});

test("ordinary copy is never mistaken for an owner", () => {
  // The reason owner extraction only runs inside Action Items, and the reason a separator is required.
  assert.equal(splitOwner("Zeal investment committee meets tomorrow morning").owner, null);
  assert.equal(splitOwner("Value Care Group sent an LOI this week").owner, null);
  // A hyphen only counts with spaces round it, so a hyphenated word cannot become a name.
  assert.equal(splitOwner("Follow-up sequence needs rewriting").owner, null);
});

test("owners are only read inside action items", () => {
  const { sections } = parseRecap("Deals\n1. Zeal: committee meets tomorrow\n\nAction Items\n1. Kori — do the thing");
  const deals = sections.find((s) => s.key === "deals");
  const actions = sections.find((s) => s.key === "actions");
  assert.equal(deals.items[0].owner, null, "a deal was given an owner");
  assert.ok(deals.items[0].text.includes("Zeal"));
  assert.equal(actions.items[0].owner, "Kori");
});

/* ── The whole document ─────────────────────────────────────────────────────────────────────── */

test("a call parses into a header, a recap and a transcript held apart", () => {
  const call = parseCall(CALL);
  assert.equal(call.title, "Steadywell <> QC Weekly");
  assert.equal(call.date, "2026-08-20");
  assert.equal(call.postedTo, "Internal");
  assert.equal(call.durationMinutes, 30);
  assert.equal(call.attendees.length, 7);
  assert.equal(call.attendees[0].host, true);
  assert.equal(call.attendees[1].host, false);

  // The fault this whole rewrite is about: the transcript is its own thing, not the tail of the recap.
  assert.ok(call.transcript.startsWith("Kiril: Right, let us get started"));
  assert.ok(!call.sections.some((s) => s.items.some((i) => i.text.includes("let us get started"))));
  assert.ok(call.transcriptWords > 10);
});

test("action items are shown first, whatever order they were written in", () => {
  const call = parseCall(CALL);
  // The generator emits them third. The prompt calls them the most important section, so they lead.
  assert.equal(call.sections[0].key, "actions");
  assert.equal(call.actionCount, 3);
  assert.deepEqual(call.sections[0].items.map((i) => i.owner), ["Kori", "Tim", "Kiril"]);
  assert.equal(call.sections[0].items[2].sub, "Both launch Thursday, so it has to be set before Wednesday night");
});

test("the date is not printed twice in the title", () => {
  // The h1 is "Title — 2026-08-20" and the frontmatter already carries the date on its own.
  assert.equal(parseCall(CALL).title, "Steadywell <> QC Weekly");
  assert.ok(!parseCall(CALL).title.includes("2026-08-20"));
});

test("a call with no transcript does not pretend to have one", () => {
  const call = parseCall("---\ntitle: Thin\ncall_date: 2026-01-01\n---\n\n## Recap\n\nCampaigns\n1. A thing\n");
  assert.equal(call.transcript, "");
  assert.equal(call.transcriptWords, 0);
  assert.equal(call.sections.length, 1);
});

test("a document with no recognisable structure keeps its text", () => {
  const call = parseCall("Just some loose notes about the call.");
  assert.ok(call.intro.includes("loose notes") || call.sections.length > 0);
});

test("every section in the render order is a real section", () => {
  const call = parseCall(CALL);
  for (const section of call.sections) assert.ok(RENDER_ORDER.includes(section.key), `${section.key} has no place in the order`);
});

test("word count is a count of words", () => {
  assert.equal(wordCount("one two three"), 3);
  assert.equal(wordCount("   "), 0);
});
