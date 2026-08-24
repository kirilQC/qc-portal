// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * The messaging parsers, tested against the documents that actually exist.
 *
 * The fixture below is Steadywell's "ACOs v2" as written, frontmatter and all — the document whose
 * frontmatter was being printed as body copy on screen. The campaign names are real too, taken from the
 * HeyReach exports, including the two that share the SW013 code and the one whose document carries no
 * code at all.
 *
 * The property most of these assert is not "the parser finds the steps" but "the parser never silently
 * loses copy" — a messaging tab that quietly drops a follow-up nobody notices is worse than one that
 * shows the document as written.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CONNECTION_LIMIT, campaignCode, matchCampaign, messageLength, nameSimilarity, nameTokens,
  parseSequence, splitFrontmatter, variablesIn,
} from "../shared/messaging.mjs";

const ACOS_V2 = `---
title: ACOs v2
source: Google Doc campaign messaging
tab_id: t.glkhnloqp6cz
last_synced: 2026-08-23
---

# ACOs v2

**Senders: Josh & Tim**

**Connection request (250)**

Hi {FIRST_NAME}, I'm currently building Steadywell, an AI-powered proactive care and patient engagement platform. I'd love to connect and get your insight on what we've built!

**LI Follow Up 1 |**

Hi {FIRST_NAME}, thanks for connecting! I'd love to pick your brain for a few minutes, if you're up for it.

**LI Follow Up 2 |**

Hi {FIRST_NAME}, just wanted to bump my previous message. Would love to connect for a quick chat!

**EMAIL Follow Up**

**Subject Line: Patient Engagement Opportunity**

**VERSION FROM TIM:**

Hi {FIRST_NAME},

I had reached out on LinkedIn, but thought I'd try to connect via email as well.

**VERSION FROM JOSH:**

Hi {FIRST_NAME}, following up here as well.
`;

/* ── Frontmatter ────────────────────────────────────────────────────────────────────────────── */

test("frontmatter is metadata, not the first five lines of the message", () => {
  const { meta, body } = splitFrontmatter(ACOS_V2);
  assert.equal(meta.title, "ACOs v2");
  assert.equal(meta.last_synced, "2026-08-23");
  assert.equal(meta.tab_id, "t.glkhnloqp6cz");
  // The bug this fixes: none of the machinery survives into the body.
  assert.ok(!body.includes("---"));
  assert.ok(!body.includes("tab_id"));
  assert.ok(body.startsWith("# ACOs v2"));
});

test("a document with no frontmatter is returned untouched", () => {
  const { meta, body } = splitFrontmatter("# Just a note\n\nHello.");
  assert.deepEqual(meta, {});
  assert.equal(body, "# Just a note\n\nHello.");
});

test("an unclosed frontmatter fence does not swallow the document", () => {
  // Losing metadata is recoverable; losing somebody's copy is not.
  const { meta, body } = splitFrontmatter("---\ntitle: Broken\n\n# Real heading\n\nCopy here.");
  assert.deepEqual(meta, {});
  assert.ok(body.includes("Copy here."));
});

/* ── The sequence ───────────────────────────────────────────────────────────────────────────── */

test("a document parses into its four steps, in send order", () => {
  const { body } = splitFrontmatter(ACOS_V2);
  const { steps } = parseSequence(body);
  assert.deepEqual(steps.map((s) => s.label), [
    "Connection request", "Follow-up 1", "Follow-up 2", "Email follow-up",
  ]);
  assert.deepEqual(steps.map((s) => s.channel), ["linkedin", "linkedin", "linkedin", "email"]);
});

test("the title and senders are read off the document, not out of a step", () => {
  const { body } = splitFrontmatter(ACOS_V2);
  const parsed = parseSequence(body);
  assert.equal(parsed.title, "ACOs v2");
  assert.deepEqual(parsed.senders, ["Josh", "Tim"]);
  // "Senders:" must not survive as a paragraph of the first step.
  assert.ok(!parsed.steps[0].body.toLowerCase().includes("senders"));
});

test("a stated character budget is honoured over LinkedIn's ceiling", () => {
  const { steps } = parseSequence(splitFrontmatter(ACOS_V2).body);
  assert.equal(steps[0].budget, 250);
  // A connection request with no stated target still gets the real limit.
  const bare = parseSequence("**Connection request**\n\nHi there!");
  assert.equal(bare.steps[0].budget, CONNECTION_LIMIT);
  assert.equal(CONNECTION_LIMIT, 300);
});

test("an email step keeps its subject line out of the body", () => {
  const { steps } = parseSequence(splitFrontmatter(ACOS_V2).body);
  const email = steps[3];
  assert.equal(email.subject, "Patient Engagement Opportunity");
  assert.ok(!email.body.includes("Subject Line"));
});

test("per-sender versions become variants rather than more steps", () => {
  const { steps } = parseSequence(splitFrontmatter(ACOS_V2).body);
  const email = steps[3];
  // Four steps, not six — "VERSION FROM TIM" is the same touch written twice.
  assert.equal(steps.length, 4);
  assert.ok(email.body.includes("I had reached out on LinkedIn"));
  assert.equal(email.variants.length, 1);
  assert.equal(email.variants[0].author, "JOSH");
  assert.ok(email.variants[0].body.includes("following up here as well"));
});

test("EMAIL follow-up is not mistaken for a LinkedIn follow-up", () => {
  // Both headers contain "follow up"; only the order of the tests keeps them apart.
  const { steps } = parseSequence("**LI Follow Up 1**\n\na\n\n**EMAIL Follow Up**\n\nb");
  assert.equal(steps[0].channel, "linkedin");
  assert.equal(steps[1].channel, "email");
  assert.equal(steps[1].budget, null);
});

test("headings and bold lines are both read as step headers", () => {
  const asHeadings = parseSequence("## Connection request\n\nHi\n\n## Follow up 2\n\nAgain");
  assert.deepEqual(asHeadings.steps.map((s) => s.label), ["Connection request", "Follow-up 2"]);
});

test("a document with no recognisable steps keeps all of its text", () => {
  // "Summary" and "New ideas" are real documents in the folder and neither is a sequence.
  const parsed = parseSequence("Some loose thoughts.\n\nAnd a second paragraph.");
  assert.equal(parsed.steps.length, 0);
  assert.ok(parsed.preamble.includes("Some loose thoughts."));
  assert.ok(parsed.preamble.includes("second paragraph"));
});

test("bold inside a sentence is not treated as a header", () => {
  const parsed = parseSequence("**Connection request**\n\nHi, we are **really** glad to connect.");
  assert.equal(parsed.steps.length, 1);
  assert.ok(parsed.steps[0].body.includes("really"));
});

test("character count ignores markdown marks, because LinkedIn does not send them", () => {
  assert.equal(messageLength("**Hi**"), 2);
  assert.equal(messageLength("  Hi there  "), 8);
});

test("merge fields are listed once each, in order", () => {
  assert.deepEqual(variablesIn("Hi {FIRST_NAME}, how is {COMPANY}? Bye {FIRST_NAME}"), ["FIRST_NAME", "COMPANY"]);
  assert.deepEqual(variablesIn("no tokens here"), []);
});

/* ── The campaign join ──────────────────────────────────────────────────────────────────────── */

const CAMPAIGNS = [
  { campaignId: "1", name: "SW001_ Business Leaders" },
  { campaignId: "2", name: "SW002_ Clinical Leaders" },
  { campaignId: "3", name: "SW011_ COO" },
  { campaignId: "4", name: "SW011_COO_retarget" },
  { campaignId: "5", name: "SW013_ FQHC (Business)" },
  { campaignId: "6", name: "SW013_ FQHC (Clinical)" },
  { campaignId: "7", name: "SW016_ Social Signals Week 2" },
];

test("a campaign code is read off either spelling", () => {
  assert.equal(campaignCode("SW001_ Business Leaders"), "SW001");
  assert.equal(campaignCode("Sw001 business leaders"), "SW001");
  assert.equal(campaignCode("V084_ Parker Phoenix"), "V084");
  // An ordinary first word must never be read as a code.
  assert.equal(campaignCode("Core icp remarketing"), null);
  assert.equal(campaignCode("New ideas"), null);
});

test("a coded document matches its campaign exactly", () => {
  const match = matchCampaign("Sw001 business leaders", CAMPAIGNS);
  assert.equal(match.campaignId, "1");
  assert.equal(match.confidence, "exact");
});

test("campaigns sharing a code are separated by the rest of the name", () => {
  // SW013 is two campaigns; the code proves the family and "clinical" picks the member.
  assert.equal(matchCampaign("Sw013 fqhc clinical", CAMPAIGNS).campaignId, "6");
  assert.equal(matchCampaign("Sw013 fqhc business", CAMPAIGNS).campaignId, "5");
});

test("an uncoded document still finds its campaign, as a suggestion", () => {
  // The case that makes the second pass necessary: a human reads this instantly, a code match cannot.
  const match = matchCampaign("Coos retarget rory kori", CAMPAIGNS);
  assert.equal(match.campaignId, "4");
  assert.equal(match.confidence, "suggested");
  // And it must never claim to be certain.
  assert.notEqual(match.confidence, "exact");
});

test("a document about nothing in the list matches nothing", () => {
  assert.equal(matchCampaign("New ideas", CAMPAIGNS), null);
  assert.equal(matchCampaign("Summary", CAMPAIGNS), null);
  assert.equal(matchCampaign("Care coordination navigation job posting", CAMPAIGNS), null);
});

test("two campaigns fitting equally well produce no suggestion at all", () => {
  // A real ambiguity: SW013 ran as both Business and Clinical, and an uncoded document called simply
  // "Fqhc" cannot tell you which one it was written for. A coin toss presented as an answer is worse
  // than an honest blank.
  assert.equal(matchCampaign("Fqhc", CAMPAIGNS), null);
  assert.equal(matchCampaign("Fqhc messaging", CAMPAIGNS), null);
  // Say one word about which, though, and it resolves.
  assert.equal(matchCampaign("Fqhc clinical", CAMPAIGNS).campaignId, "6");
});

test("similarity ignores filler words and matches singular against plural", () => {
  assert.deepEqual(nameTokens("SW011_ COO"), ["coo"]);
  assert.ok(nameSimilarity("Coos retarget", "SW011_COO_retarget") >= 0.6);
  // "co" is too short to be a prefix match, so it must not drag in "coordination".
  assert.ok(nameSimilarity("Co", "Care coordination") < 0.6);
});

test("no campaigns at all is not an error", () => {
  assert.equal(matchCampaign("Sw001 business leaders", []), null);
});
