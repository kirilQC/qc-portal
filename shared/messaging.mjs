// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * Reading a campaign messaging document as the sequence it actually is.
 *
 * ── Why this is parsing and not rendering ───────────────────────────────────────────────────────
 * These documents look like prose and are not. Every one has the same spine — a connection request
 * with a character budget, one or two LinkedIn follow-ups, an email follow-up with a subject line and
 * sometimes a variant per sender — which is the shape of the sequence that runs in HeyReach. Rendered
 * as flat markdown, that structure is thrown away: you cannot see the touch count, the channel of each
 * step, or that a connection request is about to blow past LinkedIn's limit. So the document is parsed
 * into steps and the steps are what gets displayed.
 *
 * ── Why it lives here rather than in the component ──────────────────────────────────────────────
 * Three separate pieces of guesswork happen in this file: what is metadata, where one message ends and
 * the next begins, and which campaign a document belongs to. Guesswork wants tests, and tests want a
 * module with no React in it. Everything here is a pure function of its input.
 *
 * ── The bias throughout ─────────────────────────────────────────────────────────────────────────
 * When a line cannot be classified it stays in the body of whatever step it fell in, and when a
 * document matches no known step at all it comes back as a single prose block. A parser that drops
 * what it does not recognise would silently hide somebody's copy; this one degrades to showing the
 * document as written.
 */

/* ── Frontmatter ────────────────────────────────────────────────────────────────────────────────
 *
 * Every document opens with a YAML block that the previous renderer printed as body text — five lines
 * of machinery ahead of the first word of the message. It is metadata: the sync date and a pointer at
 * the Google Doc it came from, both worth showing, neither of them prose.
 */

/**
 * Split a leading `---` fenced block off the front of a document.
 *
 * Deliberately shallow: these blocks are flat `key: value` pairs written by one generator, and a real
 * YAML parser would be a dependency bought for nothing. A block that does not close is treated as
 * absent rather than swallowing the document — losing the frontmatter is recoverable, losing the copy
 * is not.
 *
 * @param {string} markdown
 * @returns {{ meta: Record<string,string>, body: string }}
 */
export function splitFrontmatter(markdown) {
  // A byte-order mark ahead of the opening fence would stop it matching, and these documents come out
  // of an exporter. Written as an escape rather than the character itself, which is invisible in source.
  const text = String(markdown ?? "").replace(/^\uFEFF/, "");
  if (!/^---\s*\r?\n/.test(text)) return { meta: {}, body: text };

  const lines = text.split(/\r?\n/);
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (/^---\s*$/.test(lines[i])) { end = i; break; }
  }
  if (end === -1) return { meta: {}, body: text };

  /** @type {Record<string,string>} */
  const meta = {};
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    meta[match[1].toLowerCase()] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: lines.slice(end + 1).join("\n").replace(/^\s*\n/, "") };
}

/* ── The sequence ───────────────────────────────────────────────────────────────────────────────
 *
 * Step headers arrive in three disguises — a markdown heading, a bold-only line, or a bare line — and
 * the writer is a person, so "LI Follow Up 1 |", "LinkedIn follow-up #1" and "Follow up 1" all mean the
 * same thing. Matching is therefore done on the *text* of any line that is structurally a header,
 * whichever way it was marked up.
 */

/** LinkedIn's own ceiling on a connection request note. A document may state a tighter target. */
export const CONNECTION_LIMIT = 300;

/**
 * Strip markdown emphasis and trailing separators from a candidate header.
 * "**LI Follow Up 1 |**" → "LI Follow Up 1"
 */
function bareHeader(line) {
  let text = line.trim();
  const heading = text.match(/^#{1,6}\s+(.*)$/);
  if (heading) text = heading[1];
  // A line that is *entirely* bold is a header in these documents; bold inside a sentence is not.
  const bold = text.match(/^\*\*(.+)\*\*[\s:|—-]*$/);
  if (bold) text = bold[1];
  return text.replace(/[\s:|·—-]+$/, "").trim();
}

/** True when a line is structurally a header — a heading, or a line that is entirely bold. */
function looksLikeHeader(line) {
  const text = line.trim();
  return /^#{1,6}\s+\S/.test(text) || /^\*\*.+\*\*[\s:|—-]*$/.test(text);
}

/**
 * Classify a header as the start of a message step, or return null.
 *
 * Order matters: "EMAIL Follow Up" must be tested before the generic follow-up pattern, or it would be
 * classified as a LinkedIn touch and shown with the wrong channel and the wrong limit.
 *
 * @returns {{ kind: string, channel: string, label: string, order: number, budget: number|null } | null}
 */
function classifyStep(headerText) {
  const text = headerText.trim();
  const lower = text.toLowerCase();

  // "(250)" after a header is the writer's own character target for that message.
  const budgetMatch = text.match(/\((\d{2,4})\s*(?:chars?|characters?)?\)/i);
  const budget = budgetMatch ? Number(budgetMatch[1]) : null;
  const nth = () => {
    const found = lower.match(/(?:follow\s*-?\s*up|fu|message|msg|touch)\s*#?\s*(\d+)/);
    return found ? Number(found[1]) : 1;
  };

  if (/^(li\s+)?connection\s*(request|note|message)?\b/.test(lower) || /^cr\b/.test(lower)) {
    return { kind: "connection", channel: "linkedin", label: "Connection request", order: 0, budget: budget ?? CONNECTION_LIMIT };
  }
  if (/\binmail\b/.test(lower)) {
    return { kind: "inmail", channel: "inmail", label: text.replace(/\s*\(\d+.*?\)\s*/i, "").trim() || "InMail", order: 5, budget };
  }
  if (/\bemail\b/.test(lower) || /^subject\s*line/.test(lower)) {
    const n = nth();
    return { kind: "email", channel: "email", label: n > 1 ? `Email follow-up ${n}` : "Email follow-up", order: 90 + n, budget };
  }
  if (/\bvoice\s*note\b|\bvoicenote\b/.test(lower)) {
    return { kind: "voice", channel: "linkedin", label: "Voice note", order: 50, budget };
  }
  if (/(?:^|\b)(?:li|linkedin)?\s*follow\s*-?\s*up\b/.test(lower) || /^(?:li\s*)?fu\s*#?\s*\d/.test(lower)) {
    const n = nth();
    return { kind: "followup", channel: "linkedin", label: `Follow-up ${n}`, order: 10 + n, budget };
  }
  return null;
}

/** Number of characters a message will actually send, ignoring markdown emphasis marks. */
export function messageLength(body) {
  return String(body ?? "")
    .replace(/\*\*|__|[*_`]/g, "")
    .trim()
    .length;
}

/** The `{TOKEN}` merge fields used in a message, in order of first appearance, without duplicates. */
export function variablesIn(body) {
  const found = String(body ?? "").match(/\{\{?\s*[A-Za-z0-9_ .-]+\s*\}?\}/g) ?? [];
  const seen = new Set();
  const out = [];
  for (const raw of found) {
    const token = raw.replace(/^\{\{?\s*|\s*\}?\}$/g, "").trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

/**
 * Parse a messaging document into an ordered list of message steps.
 *
 * @param {string} markdown  the document body, frontmatter already removed
 * @returns {{ title: string|null, senders: string[], preamble: string, steps: Array<object> }}
 */
export function parseSequence(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/);

  let title = null;
  /** @type {string[]} */
  let senders = [];
  /** @type {string[]} */
  const preamble = [];
  /** @type {Array<object>} */
  const steps = [];
  /** @type {object|null} */
  let step = null;
  /** @type {object|null} */
  let variant = null;

  /** Where the text of the line currently being read should go. */
  const sink = () => (variant ? variant.lines : step ? step.lines : preamble);

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const header = looksLikeHeader(line) ? bareHeader(line) : null;

    // "Senders: Josh & Tim" — a property of the document, not of any one step.
    const sendersMatch = (header ?? line).match(/^senders?\s*:\s*(.+)$/i);
    if (sendersMatch && !senders.length) {
      senders = sendersMatch[1].split(/\s*(?:,|&|\band\b|\/)\s*/i).map((s) => s.trim()).filter(Boolean);
      continue;
    }

    if (header) {
      // The document's own title heading, before any step has started.
      if (!step && !title && /^#\s+\S/.test(line.trim())) { title = header; continue; }

      // Subject and version are tested before classifyStep, because both would otherwise be read as the
      // start of a new step: "Subject Line: …" contains no follow-up wording but does mean email, and
      // an email step introduced by its own subject line would be split in two.
      const subject = header.match(/^subject(?:\s*line)?\s*:\s*(.+)$/i);
      if (subject) {
        // A subject arriving while a LinkedIn step is open means the email step began here without a
        // header of its own — start it, rather than hanging a subject off a LinkedIn message.
        if (!step || step.channel !== "email") {
          if (step) steps.push(step);
          step = { kind: "email", channel: "email", label: "Email follow-up", order: 91, budget: null, heading: header, subject: null, lines: [], variants: [] };
          variant = null;
        }
        step.subject = subject[1].trim();
        continue;
      }

      // "VERSION FROM TIM:" — the same step written twice, once per sender.
      if (step) {
        const versionOf = header.match(/^(?:version|copy|option)\s*(?:from|by|for)\s*:?\s*(.+)$/i);
        if (versionOf) {
          variant = { author: versionOf[1].replace(/:$/, "").trim(), lines: [] };
          step.variants.push(variant);
          continue;
        }
      }

      const found = classifyStep(header);
      if (found) {
        if (step) steps.push(step);
        step = { ...found, heading: header, subject: null, lines: [], variants: [] };
        variant = null;
        continue;
      }
    }

    // A bare (non-bold) "Subject line:" is common enough to be worth catching too.
    if (step && !step.subject && !step.lines.length) {
      const bare = line.match(/^subject(?:\s*line)?\s*:\s*(.+)$/i);
      if (bare) { step.subject = bare[1].trim(); continue; }
    }

    sink().push(line);
  }
  if (step) steps.push(step);

  const tidy = (arr) => arr.join("\n").replace(/^\s*\n+/, "").replace(/\s+$/, "");

  const finished = steps.map((s, index) => {
    const body = tidy(s.lines);
    const variants = s.variants
      .map((v) => ({ author: v.author, body: tidy(v.lines), chars: messageLength(tidy(v.lines)) }))
      .filter((v) => v.body);
    // A step whose whole body sits in per-sender variants has no shared copy of its own; show the
    // first variant as the step body so the card is never blank.
    const shown = body || variants[0]?.body || "";
    return {
      index,
      kind: s.kind,
      channel: s.channel,
      label: s.label,
      heading: s.heading,
      subject: s.subject,
      body: shown,
      chars: messageLength(shown),
      budget: s.budget,
      variables: variablesIn(`${shown}\n${s.subject ?? ""}`),
      variants: body ? variants : variants.slice(1),
    };
  });

  return { title, senders, preamble: tidy(preamble), steps: finished };
}

/* ── Joining a document to its campaign ─────────────────────────────────────────────────────────
 *
 * Two passes, because one is not enough.
 *
 * The code is exact and never wrong: campaigns are named "SW001_ Business Leaders" and the matching
 * document is "sw001-business-leaders". Roughly half the documents carry no code at all, though, and
 * one of those is the case that makes the second pass necessary — "Coos retarget rory kori" belongs to
 * "SW011_COO_retarget", which a human reads instantly and a code match misses entirely.
 *
 * The second pass is therefore reported as a *suggestion*, never as a fact. A fuzzy match that presents
 * itself as certain is worse than no match at all, because there is then no way to know which links to
 * trust.
 */

/** Words that carry no identifying signal and would otherwise inflate every similarity score. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "at", "by", "with",
  "campaign", "campaigns", "messaging", "message", "messages", "copy", "sequence", "outreach",
  "v1", "v2", "v3", "new", "final", "draft", "list", "test", "old",
]);

/**
 * Letters then digits at the head of a name.
 *
 * The end of the code is asserted with `(?!\d)` rather than `\b`, because the most common real spelling
 * is `SW001_ Business Leaders` — and between `1` and `_` there is no word boundary at all, so `\b`
 * matched nothing and every underscored campaign came back uncoded.
 */
const CODE = /^([A-Za-z]{1,4})[\s_-]*(\d{2,4})(?!\d)/;

/**
 * The campaign code leading a name, uppercased — "SW001_ Business Leaders" → "SW001".
 * Requires letters followed by digits so an ordinary first word can never be read as a code.
 */
export function campaignCode(name) {
  const match = String(name ?? "").trim().match(CODE);
  return match ? `${match[1].toUpperCase()}${match[2]}` : null;
}

/** Significant lowercase words in a name, with the code, punctuation and stopwords removed. */
export function nameTokens(name) {
  return String(name ?? "")
    .replace(CODE, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word.length > 1 && !STOPWORDS.has(word) && !/^\d+$/.test(word));
}

/**
 * Two tokens count as the same word when one is a prefix of the other and the shorter is at least
 * three characters — which is what makes "coos" match "coo" without letting "co" match "coordination".
 */
function sameWord(a, b) {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 3 && long.startsWith(short) && long.length - short.length <= 3;
}

/**
 * How alike two names are, 0–1, by the significant words they have in common.
 *
 * Scored against the combined length of both names rather than the shorter one. Dividing by the shorter
 * name looks reasonable and is not: a one-word campaign scores a perfect 1.0 off a single hit, so
 * "SW011_ COO" tied with "SW011_COO_retarget" for the document "Coos retarget rory kori" and the
 * ambiguity guard threw away a match that was in fact obvious. Counting both sides means a campaign only
 * scores well when it explains most of the document *and* the document explains most of it.
 */
export function nameSimilarity(a, b) {
  const left = nameTokens(a);
  const right = nameTokens(b);
  if (!left.length || !right.length) return 0;
  const taken = new Set();
  let hits = 0;
  for (const word of left) {
    const found = right.findIndex((other, i) => !taken.has(i) && sameWord(word, other));
    if (found !== -1) { taken.add(found); hits += 1; }
  }
  return (2 * hits) / (left.length + right.length);
}

/** A suggestion needs this much of the shorter name in common before it is worth showing. */
const SUGGEST_THRESHOLD = 0.6;

/**
 * Match one document title against a list of campaigns.
 *
 * @param {string} docTitle
 * @param {Array<{campaignId: string, name: string}>} campaigns
 * @returns {{ campaignId: string, name: string, confidence: "exact"|"suggested", score: number } | null}
 */
export function matchCampaign(docTitle, campaigns) {
  const list = Array.isArray(campaigns) ? campaigns : [];
  if (!list.length) return null;

  const code = campaignCode(docTitle);
  if (code) {
    const sharing = list.filter((c) => campaignCode(c.name) === code);
    if (sharing.length === 1) {
      return { campaignId: sharing[0].campaignId, name: sharing[0].name, confidence: "exact", score: 1 };
    }
    // Several campaigns share the code — "SW013_ FQHC (Business)" and "SW013_ FQHC (Clinical)" — so the
    // rest of the name decides which. Still exact: the code already proved the family.
    if (sharing.length > 1) {
      const best = sharing
        .map((c) => ({ c, score: nameSimilarity(docTitle, c.name) }))
        .sort((x, y) => y.score - x.score)[0];
      return { campaignId: best.c.campaignId, name: best.c.name, confidence: "exact", score: best.score };
    }
  }

  const ranked = list
    .map((c) => ({ c, score: nameSimilarity(docTitle, c.name) }))
    .filter((entry) => entry.score >= SUGGEST_THRESHOLD)
    .sort((x, y) => y.score - x.score);
  if (!ranked.length) return null;

  // Two campaigns fitting equally well is not a suggestion, it is a coin toss — say nothing instead.
  if (ranked.length > 1 && ranked[0].score - ranked[1].score < 0.01) return null;

  return { campaignId: ranked[0].c.campaignId, name: ranked[0].c.name, confidence: "suggested", score: ranked[0].score };
}
