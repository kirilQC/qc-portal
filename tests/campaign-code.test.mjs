// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * Which campaigns count as QC's work, pinned on real names from the data.
 *
 * The portal only shows replies, leads and sending from QC's campaigns (app/lib/qc-conversations.ts), so
 * this rule decides what every client sees. CAMB's own "India Today Lookalike" counting as QC's would be
 * the same bug as before; Ema's "EM031v2" not counting would empty Ema's inbox.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { isOurCampaign } from "../shared/campaign-code.mjs";

test("QC-coded campaigns are ours, including relaunches and status prefixes", () => {
  for (const name of ["EM031v2: Master ICP - Clinical (Morgan)", "EM032: Women in Bio", "MS-12a PLG", "[PAUSED] EM031v2 Business", "Thinkwell x QC Foundation Campaign v2"]) {
    assert.equal(isOurCampaign(name), true, name);
  }
});

test("a client's own campaigns are not ours", () => {
  for (const name of ["India Today Lookalike", "CAMB Live Commentary - Sports", "AWS re:invent 2025 New", "CISO Cold outreach, June 9, 2026", "Medical/Not-Womens-Health", ""]) {
    assert.equal(isOurCampaign(name), false, name);
  }
});
