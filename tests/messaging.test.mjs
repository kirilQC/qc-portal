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
  CONNECTION_LIMIT, SORTS, campaignCode, matchCampaign, messageLength, nameSimilarity, nameTokens,
  parseSequence, positiveRateOf, replyRateOf, sortDocs, splitFrontmatter, totalChars, variablesIn,
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

test("the limit is always LinkedIn's 300, never the document's house target", () => {
  const { steps } = parseSequence(splitFrontmatter(ACOS_V2).body);
  // "(250)" in the header is a preference. Measuring against it flagged a perfectly sendable
  // 260-character request red, as though it were broken.
  assert.equal(steps[0].budget, 300);
  assert.equal(steps[0].target, 250);
  assert.equal(CONNECTION_LIMIT, 300);

  const bare = parseSequence("**Connection request**\n\nHi there!");
  assert.equal(bare.steps[0].budget, 300);
  assert.equal(bare.steps[0].target, null);

  // Only connection requests have a ceiling at all — nothing else can fail to send on length.
  assert.equal(parseSequence("**LI Follow Up 1**\n\nHi").steps[0].budget, null);
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
  // Both versions keep their names. An earlier version promoted the first into the step body to avoid
  // an empty card, which threw away its label and left one unnamed message beside one named one.
  assert.deepEqual(email.variants.map((v) => v.label), ["TIM", "JOSH"]);
  assert.ok(email.variants[0].body.includes("I had reached out on LinkedIn"));
  assert.ok(email.variants[1].body.includes("following up here as well"));
  assert.equal(email.body, "");
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

/* ── Ordering the index ─────────────────────────────────────────────────────────────────────── */

const DOCS = [
  // A campaign that ran before sentiment scoring existed: 40 replies, none of them ever classified.
  { title: "Zulu", steps: [{ chars: 100 }], stats: { replyRate: 22, positiveReplyRate: 0, scoredReplies: 0, replies: 40 } },
  { title: "Alpha", steps: [{ chars: 300 }, { chars: 200 }], stats: { replyRate: 9, positiveReplyRate: 2, scoredReplies: 30, replies: 30 } },
  { title: "Mike", steps: [{ chars: 50 }], stats: { replyRate: 18, positiveReplyRate: 7, scoredReplies: 12, replies: 12 } },
  // No campaign matched at all, so no rates of any kind.
  { title: "Bravo", steps: [{ chars: 400 }], stats: null },
];

const order = (mode) => sortDocs(DOCS, mode).map((doc) => doc.title);

test("alphabetical is alphabetical, and does not mutate the input", () => {
  const before = DOCS.map((doc) => doc.title);
  assert.deepEqual(order("az"), ["Alpha", "Bravo", "Mike", "Zulu"]);
  assert.deepEqual(DOCS.map((doc) => doc.title), before);
});

test("length counts the whole sequence, not the longest message in it", () => {
  // Alpha is two messages totalling 500; Bravo is one of 400.
  assert.deepEqual(order("longest"), ["Alpha", "Bravo", "Zulu", "Mike"]);
  assert.deepEqual(order("shortest"), ["Mike", "Zulu", "Bravo", "Alpha"]);
});

test("per-sender variants do not inflate the length", () => {
  // Two versions of one message is not more messaging than one version of it.
  const doc = { title: "x", steps: [{ chars: 100, variants: [{ chars: 100 }, { chars: 100 }] }] };
  assert.equal(totalChars(doc), 100);
});

test("reply rate sorts both ways, with no campaign sinking to the bottom", () => {
  assert.deepEqual(order("reply-best"), ["Zulu", "Mike", "Alpha", "Bravo"]);
  assert.deepEqual(order("reply-worst"), ["Alpha", "Mike", "Zulu", "Bravo"]);
});

test("an unscored campaign is unknown, not worst", () => {
  // Zulu's positive rate reads 0 in the database only because nobody classified its replies. Sorting it
  // as the worst performer would be an accusation the data does not support.
  assert.equal(positiveRateOf(DOCS[0]), null);
  // Zulu and Bravo are both unknown for different reasons, so they tie and fall back to alphabetical —
  // and they sit together at the bottom whichever direction the known rates point.
  assert.deepEqual(order("positive-worst"), ["Alpha", "Mike", "Bravo", "Zulu"]);
  assert.deepEqual(order("positive-best"), ["Mike", "Alpha", "Bravo", "Zulu"]);
});

test("a scored campaign that genuinely got no positive replies still sorts as zero", () => {
  // The distinction that matters: classified and zero is a real result; unclassified is not.
  const scored = { title: "s", stats: { replyRate: 5, positiveReplyRate: 0, scoredReplies: 20, replies: 20 } };
  assert.equal(positiveRateOf(scored), 0);
});

test("every offered sort returns every document", () => {
  for (const [mode] of SORTS) {
    assert.equal(sortDocs(DOCS, mode).length, DOCS.length, `${mode} lost a document`);
  }
});

/* ── The two documents that broke the first parser ──────────────────────────────────────────────
 *
 * Both are real, transcribed from what the portal was rendering. They are kept verbatim because every
 * one of the faults below was a detail of formatting that looked insignificant until it ate somebody's
 * copy.
 */

// Steadywell. Two versions of the connection request separated by a bare rule, and a follow-up header
// written `**Follow Up 1** _|_` — the trailing `_|_` is what stopped it being recognised.
const COOS_RETARGET = `- _31% Reply Rate as of 6/4_
Hi {FIRST_NAME}, I support an AI health company improving outcomes for seriously ill patients, without burdening care teams.

We're expanding the advisory council and think your background is a great fit. I'd love to connect you with the Steadywell founders!

-

Hi {FIRST_NAME}, I support a healthcare startup improving outcomes through natural voice AI, unlocking proactive care and patient engagement, without burdening care teams.

We're expanding the advisory council and think your background is a great fit. I'd love to connect you with the Steadywell founders!

**Follow Up 1** _|_

Hi {FIRST_NAME}, Steadywell is speaking with healthcare leaders about using AI to drive patient engagement without adding burden to care teams. Are you open to connecting on this topic?

**Follow Up 2**

Hi {FIRST_NAME}, if this is of interest to you, would you be open to a short conversation?
`;

// Cotool. An unbolded ALL-CAPS connection-request header, three A/B/C variants whose labels share a
// line with the copy, then a bare EMAIL marker followed by three numbered steps.
const COTOOL = `DAY 0 + 1 HR — CONNECT REQUEST NOTE

Test A:  Hey {FIRST_NAME}, saw your name pop up in the SecOps space. Curious if you've tried building your own agentic automations across the SOC?

Test B:

Hi {FIRST_NAME}, noticed you on my feed a few times. Would love your take if you're open to connecting

Test C:

Hey {FIRST_NAME}, saw your name pop up a few times. Curious what your experience has been with building custom agents in the SOC?

FOLLOW UP 1

Test A: Thanks for connecting, {FIRST_NAME}. Worth a look?

Test B: Appreciate the connect, {FIRST_NAME}. Worth a look?

EMAIL

STEP 1

Subject options: Agents to reduce the noise

Hi {{first_name}},

Came across your name through some overlapping security circles on LinkedIn.

STEP 2

Hi {{first_name}}, following up on the below.

STEP 3

Last note from me, {{first_name}}.
`;

test("a follow-up header decorated with _|_ is still a header", () => {
  // The fault that made one card read 794 characters against a 300 limit: the header was invisible to
  // the parser, so the follow-up was swallowed into the connection request above it.
  const { steps } = parseSequence(COOS_RETARGET);
  assert.deepEqual(steps.map((s) => s.label), ["Follow-up 1", "Follow-up 2"]);
  assert.ok(steps[0].body.includes("Steadywell is speaking with healthcare leaders"));
  assert.ok(!steps[0].body.includes("advisory council"), "the connection request leaked into the follow-up");
});

test("a bare rule between two message bodies opens a second version", () => {
  const { preamble } = parseSequence(COOS_RETARGET);
  // Both openers survive. Which container they land in matters less than that neither is lost.
  assert.ok(preamble.includes("I support an AI health company"));
  assert.ok(preamble.includes("I support a healthcare startup"));
});

test("versions separated by a rule are kept apart, not concatenated", () => {
  const { steps } = parseSequence("**Connection request**\n\nFirst version here.\n\n-\n\nSecond version here.");
  assert.equal(steps.length, 1);
  assert.equal(steps[0].variants.length, 1);
  assert.ok(steps[0].body.includes("First version"));
  assert.ok(steps[0].variants[0].body.includes("Second version"));
  assert.ok(!steps[0].body.includes("Second version"));
});

test("an unbolded ALL-CAPS connect-request header is recognised", () => {
  // "DAY 0 + 1 HR — CONNECT REQUEST NOTE" is not bold and does not start with the word "connection".
  const { steps } = parseSequence(COTOOL);
  assert.equal(steps[0].label, "Connection request");
  assert.equal(steps[0].channel, "linkedin");
  assert.equal(steps[0].budget, 300);
});

test("A/B/C variants sharing a line with their copy each keep their own label", () => {
  const { steps } = parseSequence(COTOOL);
  const connect = steps[0];
  assert.deepEqual(connect.variants.map((v) => v.label), ["Test A", "Test B", "Test C"]);
  assert.ok(connect.variants[0].body.includes("saw your name pop up in the SecOps space"));
  assert.ok(connect.variants[1].body.includes("noticed you on my feed"));
  // Each version is measured on its own; one character count for three messages means nothing.
  assert.ok(connect.variants.every((v) => v.chars > 0));
});

test("three numbered email steps are three steps, not one enormous follow-up", () => {
  // The reported fault: "there was clearly 3 emails in here but it got jumbled up into the follow up 1".
  const { steps } = parseSequence(COTOOL);
  const emails = steps.filter((s) => s.channel === "email");
  assert.deepEqual(emails.map((s) => s.label), ["Email 1", "Email 2", "Email 3"]);
  assert.ok(emails[0].body.includes("overlapping security circles"));
  assert.ok(emails[1].body.includes("following up on the below"));
  assert.ok(emails[2].body.includes("Last note from me"));
  assert.ok(!emails[0].body.includes("Last note from me"), "the emails ran together");
});

test("a bare EMAIL line sets the channel without becoming a step of its own", () => {
  const { steps } = parseSequence(COTOOL);
  assert.ok(!steps.some((s) => s.label.toLowerCase() === "email"), "the marker became a step");
  // And the LinkedIn follow-up above it stayed on LinkedIn.
  assert.equal(steps.find((s) => s.label === "Follow-up 1").channel, "linkedin");
});

test("a subject line is attached to its email rather than starting another one", () => {
  const { steps } = parseSequence(COTOOL);
  const first = steps.filter((s) => s.channel === "email")[0];
  assert.equal(first.subject, "Agents to reduce the noise");
  assert.ok(!first.body.includes("Subject options"));
});

test("a sentence mentioning a connection request does not end the message", () => {
  // The guard that keeps the looser header matching safe.
  const body = "**Follow Up 1**\n\nHi {FIRST_NAME}, I sent you a connection request last week.\n\nStill keen to talk?";
  const { steps } = parseSequence(body);
  assert.equal(steps.length, 1);
  assert.ok(steps[0].body.includes("connection request last week"));
});

test("both merge-field spellings and bracketed placeholders are recognised", () => {
  assert.deepEqual(variablesIn("Hi {FIRST_NAME} and {{first_name}} and [First Name]"), ["FIRST_NAME"]);
  assert.deepEqual(variablesIn("Hi [First Name], from {COMPANY}"), ["First Name", "COMPANY"]);
});
