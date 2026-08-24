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
 * The first version of this parser assumed a document was a list of single messages under tidy bold
 * headers. Two real documents killed that assumption at once.
 *
 * Steadywell's "COOs (Retarget)" writes its second follow-up header as `**Follow Up 1** _|_`. The
 * trailing `_|_` meant the line did not match "a line that is entirely bold", so the header was never
 * recognised and the whole follow-up was swallowed into the connection request above it — which is why
 * that card read 794 characters against a 300 limit.
 *
 * Cotool's "Social Signals" is worse and more instructive. Its connection request is headed
 * `DAY 0 + 1 HR — CONNECT REQUEST NOTE`, which is not bold at all and does not begin with the word
 * "connection". Under it are three A/B/C variants written as `Test A:`, `Test B:`, `Test C:` — the
 * prefix sharing a line with the copy. Then a bare `EMAIL` line, then `STEP 1`, `STEP 2`, `STEP 3`,
 * which are three separate emails and were arriving as one enormous follow-up.
 *
 * So this version works differently in three ways.
 *
 * A header does not have to be bold. A markdown heading, an all-bold line, an ALL-CAPS line and a short
 * line matching a known step word all count, with guards so a sentence of body copy cannot be mistaken
 * for one.
 *
 * A step can hold several variants, and a variant marker may share its line with the copy that follows
 * it. `Test A:`, `Option 2`, `Variation 3`, `VERSION FROM TIM:` and a bare `-` between two message
 * bodies all open a new variant rather than a new step.
 *
 * There is a running channel context. A line that is just `EMAIL` does not start a step, it says that
 * what follows is email — so the `STEP 1` under it becomes "Email 1" rather than an untyped step, and
 * a "Follow up" under it is an email follow-up rather than a LinkedIn one.
 */

/**
 * LinkedIn's ceiling on a connection request note.
 *
 * This is the only number that can make a message fail to send, so it is the only one the character
 * count is ever measured against. A document that writes "(250)" after the header is stating its own
 * house target — worth keeping and worth showing, but treating it as the limit meant a perfectly
 * sendable 260-character request was flagged red as if it were broken.
 */
export const CONNECTION_LIMIT = 300;

/**
 * A header line reduced to its words.
 *
 * Strips the heading marks, every emphasis character, and any leading or trailing decoration. The
 * decoration set has to include `_` and `|`: the real header `**Follow Up 1** _|_` is why this parser
 * was rewritten, and a trailing-character class that omits them silently loses the step.
 */
function cleanHeader(line) {
  return String(line)
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/[*_`~]/g, "")
    .replace(/^[\s|·—–-]+/, "")
    .replace(/[\s:|·—–-]+$/, "")
    .trim();
}

/** Patterns that make a bare, unemphasised line worth reading as a header. */
const STEP_WORDS = /connect(?:ion)?\s*request|connection\s*note|invite\s*note|follow\s*-?\s*up|^step\s*#?\s*\d|^(?:email|e-mail|linkedin|inmail|li)$|^cr\b|voice\s*note/i;

/**
 * Is this line structurally a header rather than a sentence?
 *
 * The guards matter more than the patterns. Body copy in these documents is addressed to a person, so
 * anything carrying a merge field, ending in sentence punctuation, or running long is refused however
 * well it matches — otherwise "I sent you a connection request last week" would end a message and start
 * a new one in the middle of somebody's copy.
 */
function looksLikeHeader(line) {
  const raw = String(line).trim();
  if (!raw) return false;
  if (/^#{1,6}\s+\S/.test(raw)) return true;

  // Entirely bold, allowing the trailing decoration that broke the previous version.
  if (/^(\*\*|__)\S/.test(raw) && /(\*\*|__)[\s|·—–_*-]*$/.test(raw)) return true;

  const cleaned = cleanHeader(raw);
  if (!cleaned || cleaned.length > 80) return false;
  if (/[.!?]$/.test(cleaned)) return false;
  if (/\{|\}|\[/.test(cleaned)) return false;

  // An all-caps line is a section marker in every one of these documents.
  const letters = cleaned.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 3 && cleaned === cleaned.toUpperCase()) return true;

  return STEP_WORDS.test(cleaned);
}

/** `EMAIL` / `LINKEDIN` / `INMAIL` on a line of its own: not a step, a statement about what follows. */
function channelMarker(cleaned) {
  const text = cleaned.toLowerCase().replace(/[^a-z]/g, "");
  if (text === "email" || text === "emails") return "email";
  if (text === "inmail" || text === "inmails") return "inmail";
  if (text === "linkedin" || text === "li") return "linkedin";
  return null;
}

/**
 * A variant marker, and whatever copy shared the line with it.
 *
 * `Test A:  Hey {FIRST_NAME}, saw your name…` is one line carrying both the label and the start of the
 * message, which is why this returns the remainder rather than just a boolean.
 */
function classifyVariant(text) {
  const line = String(text).trim();

  const versionFrom = line.match(/^(?:version|copy|option)\s+(?:from|by|for)\s+([^:]{1,40}):?\s*(.*)$/i);
  if (versionFrom) return { label: versionFrom[1].trim(), rest: versionFrom[2] ?? "" };

  const labelled = line.match(/^(test|option|variation|variant|version|ver|v)\s*([A-Za-z0-9]{1,3})\s*[:.)]\s*(.*)$/i);
  if (labelled) {
    const word = labelled[1].toLowerCase();
    const pretty = word === "v" || word === "ver" ? "Version" : word.charAt(0).toUpperCase() + word.slice(1);
    return { label: `${pretty} ${labelled[2].toUpperCase()}`, rest: labelled[3] ?? "" };
  }
  return null;
}

/**
 * Classify a header as the start of a message step, or return null.
 *
 * `channel` is the running context set by a bare `EMAIL` line or by the previous step, and it decides
 * what an otherwise untyped "STEP 2" or "Follow up 3" belongs to.
 *
 * Order matters throughout: "EMAIL Follow Up" has to be tested before the generic follow-up pattern or
 * it lands on LinkedIn with the wrong channel and the wrong limit.
 */
function classifyStep(headerText, channel) {
  const text = String(headerText).trim();
  const lower = text.toLowerCase();

  // "(250)" after a header is the writer's own character target — a preference, never the limit.
  const targetMatch = text.match(/\((\d{2,4})\s*(?:chars?|characters?)?\)/i);
  const target = targetMatch ? Number(targetMatch[1]) : null;
  const numberIn = (pattern) => {
    const found = lower.match(pattern);
    return found ? Number(found[1]) : null;
  };
  const nth = () => numberIn(/(?:follow\s*-?\s*up|fu|message|msg|touch|step|email)\s*#?\s*(\d+)/) ?? 1;

  if (/connect(?:ion)?\s*request|connection\s*note|invite\s*note/.test(lower) || /^cr\b/.test(lower)) {
    return { kind: "connection", channel: "linkedin", label: "Connection request", budget: CONNECTION_LIMIT, target };
  }
  if (/\binmail\b/.test(lower)) {
    return { kind: "inmail", channel: "inmail", label: "InMail", budget: null, target };
  }
  if (/\bvoice\s*note\b|\bvoicenote\b/.test(lower)) {
    return { kind: "voice", channel: "linkedin", label: "Voice note", budget: null, target };
  }

  // A bare "STEP 2" takes its channel and its wording from whatever section it is sitting in.
  const bareStep = lower.match(/^step\s*#?\s*(\d+)/);
  if (bareStep) {
    const n = Number(bareStep[1]);
    if (channel === "email") return { kind: "email", channel: "email", label: `Email ${n}`, budget: null, target };
    if (channel === "inmail") return { kind: "inmail", channel: "inmail", label: `InMail ${n}`, budget: null, target };
    return { kind: "followup", channel: "linkedin", label: `Message ${n}`, budget: null, target };
  }

  if (/\bemail\b/.test(lower)) {
    const n = nth();
    return { kind: "email", channel: "email", label: n > 1 ? `Email ${n}` : "Email follow-up", budget: null, target };
  }
  if (/follow\s*-?\s*up/.test(lower) || /^(?:li\s*)?fu\s*#?\s*\d/.test(lower)) {
    const n = nth();
    if (channel === "email") return { kind: "email", channel: "email", label: `Email follow-up ${n}`, budget: null, target };
    return { kind: "followup", channel: "linkedin", label: `Follow-up ${n}`, budget: null, target };
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

/**
 * The merge fields used in a message, in order of first appearance, without duplicates.
 *
 * Both spellings are recognised: `{FIRST_NAME}` and `{{first_name}}` appear in these documents, and so
 * does the bracketed `[First Name]` that comes from pasting out of a different tool.
 */
export function variablesIn(body) {
  const found = String(body ?? "").match(/\{\{?\s*[A-Za-z0-9_ .-]+\s*\}?\}|\[[A-Za-z][A-Za-z ]{1,20}\]/g) ?? [];
  const seen = new Set();
  const out = [];
  for (const raw of found) {
    const token = raw.replace(/^[[{]{1,2}\s*|\s*[\]}]{1,2}$/g, "").trim();
    // `{FIRST_NAME}`, `{{first_name}}` and `[First Name]` are one field written three ways, so the
    // dedup key keeps only the letters — otherwise a document that mixes spellings lists it three times.
    const key = token.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

/** A line of nothing but dashes or stars, which in these documents separates two versions of a message. */
function isSeparator(line) {
  return /^[-–—*=_]{1,5}$/.test(String(line).trim());
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
  let senders = [];
  const preamble = [];
  const steps = [];
  let step = null;
  let variant = null;
  /** Set by a bare `EMAIL` line and by each classified step; decides what an untyped "STEP 2" is. */
  let channel = null;

  const sink = () => (variant ? variant.lines : step ? step.lines : preamble);
  const openVariant = (label) => {
    if (!step) return;
    variant = { label: label || `Version ${step.variants.length + 1}`, lines: [] };
    step.variants.push(variant);
  };
  const openStep = (found, heading) => {
    if (step) steps.push(step);
    step = { ...found, heading, subject: null, lines: [], variants: [] };
    variant = null;
    channel = found.channel;
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const trimmed = line.trim();

    // A bare rule between two message bodies opens another version of the same step.
    if (step && trimmed && isSeparator(trimmed)) {
      // Only if there is already copy to separate *from* — a rule before any content is decoration.
      if (variant ? variant.lines.some((l) => l.trim()) : step.lines.some((l) => l.trim())) openVariant(null);
      continue;
    }

    const structural = looksLikeHeader(line);
    const cleaned = structural ? cleanHeader(line) : trimmed;

    if (structural) {
      // "Senders: Josh & Tim" — a property of the document, not of any one step.
      const sendersMatch = cleaned.match(/^senders?\s*:\s*(.+)$/i);
      if (sendersMatch && !senders.length) {
        senders = sendersMatch[1].split(/\s*(?:,|&|\band\b|\/)\s*/i).map((s) => s.trim()).filter(Boolean);
        continue;
      }

      // The document's own title heading, before any step has started.
      if (!step && !title && /^#\s+\S/.test(trimmed)) { title = cleaned; continue; }

      const marker = channelMarker(cleaned);
      if (marker) { channel = marker; continue; }

      // Subject and version are tested before the step patterns: a subject line contains the word
      // "email" often enough to be misread as the start of a second email step.
      const subject = cleaned.match(/^subject(?:\s*(?:line|options?))?\s*:\s*(.+)$/i);
      if (subject) {
        if (!step || step.channel !== "email") {
          openStep({ kind: "email", channel: "email", label: "Email follow-up", budget: null, target: null }, cleaned);
        }
        step.subject = subject[1].trim();
        continue;
      }

      const asVariant = classifyVariant(cleaned);
      if (asVariant && step) {
        openVariant(asVariant.label);
        if (asVariant.rest.trim()) sink().push(asVariant.rest);
        continue;
      }

      const found = classifyStep(cleaned, channel);
      if (found) { openStep(found, cleaned); continue; }

      // A header nobody recognises is still somebody's writing: keep it where it fell.
      sink().push(line);
      continue;
    }

    // `Test A:  Hey {FIRST_NAME}, …` — a variant marker sharing its line with the copy, which is far too
    // long to pass as a header and would otherwise be read as ordinary body text.
    if (step) {
      const inline = classifyVariant(trimmed);
      if (inline) {
        openVariant(inline.label);
        if (inline.rest.trim()) sink().push(inline.rest);
        continue;
      }
      const bareSubject = trimmed.match(/^subject(?:\s*(?:line|options?))?\s*:\s*(.+)$/i);
      if (bareSubject && !step.subject) { step.subject = bareSubject[1].trim(); continue; }
    }

    sink().push(line);
  }
  if (step) steps.push(step);

  const tidy = (arr) => arr.join("\n").replace(/^\s*\n+/, "").replace(/\s+$/, "");

  const finished = steps.map((s, index) => {
    const body = tidy(s.lines);
    const variants = s.variants
      .map((v) => {
        const text = tidy(v.lines);
        return { author: v.label, label: v.label, body: text, chars: messageLength(text) };
      })
      .filter((v) => v.body);

    // Every version keeps its own name. The previous version promoted the first variant into the step
    // body to avoid an empty card, which threw away the label — so a document of Test A / Test B / Test C
    // displayed an unlabelled message followed by two labelled ones.
    const all = [...variants];
    const chars = messageLength(body);
    return {
      index,
      kind: s.kind,
      channel: s.channel,
      label: s.label,
      heading: s.heading,
      subject: s.subject,
      body,
      chars,
      budget: s.budget ?? null,
      target: s.target ?? null,
      variables: variablesIn([body, s.subject ?? "", ...all.map((v) => v.body)].join("\n")),
      variants: all,
    };
  })
    // A step that ended up with neither body nor versions was a header and nothing else.
    .filter((s) => s.body || s.variants.length || s.subject);

  return { title, senders, preamble: tidy(preamble), steps: finished.map((s, index) => ({ ...s, index })) };
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

/* ── Ordering the index ─────────────────────────────────────────────────────────────────────────
 *
 * The subtle part is not the comparison, it is what counts as missing.
 *
 * A document with no matched campaign has no reply rate; a campaign whose replies were never put
 * through sentiment analysis has no positive rate. Neither is zero. Sorted naively, "worst positive
 * reply rate" would be topped by campaigns that simply predate scoring — a ranking that reads as an
 * accusation and is really a gap in the data. So anything unknown sinks to the bottom of every rate
 * sort, ascending and descending alike, and is labelled rather than scored.
 */

/** The sorts offered, in the order they appear in the menu. */
export const SORTS = [
  ["status", "Campaign status"],
  ["az", "A–Z"],
  ["longest", "Longest messaging"],
  ["shortest", "Shortest messaging"],
  ["reply-best", "Best reply rate"],
  ["reply-worst", "Worst reply rate"],
  ["positive-best", "Best positive rate"],
  ["positive-worst", "Worst positive rate"],
];

/**
 * How many characters a sequence actually sends.
 *
 * Per-sender variants are deliberately excluded: they are the same touch written twice, so counting
 * them would make a document look longer for having two versions of one message rather than more
 * messaging in it.
 */
export function totalChars(doc) {
  return (doc?.steps ?? []).reduce((sum, step) => sum + (Number(step?.chars) || 0), 0);
}

/** A campaign's reply rate, or null when no campaign is attached. */
export function replyRateOf(doc) {
  const stats = doc?.stats;
  return stats && typeof stats.replyRate === "number" ? stats.replyRate : null;
}

/**
 * A campaign's positive reply rate, or null when it cannot be known.
 *
 * Null covers two different gaps that both have to sort the same way: no campaign attached at all, and
 * a campaign with replies that nobody ever classified.
 */
export function positiveRateOf(doc) {
  const stats = doc?.stats;
  if (!stats || typeof stats.positiveReplyRate !== "number") return null;
  if ((stats.scoredReplies ?? 0) === 0 && (stats.replies ?? 0) > 0) return null;
  return stats.positiveReplyRate;
}

/**
 * Order documents for the index.
 *
 * Returns a new array; `mode` "status" is returned untouched because grouping does that ordering.
 *
 * @param {Array<object>} docs
 * @param {string} mode  one of the keys in SORTS
 */
export function sortDocs(docs, mode) {
  const list = [...(docs ?? [])];
  const byTitle = (a, b) => String(a.title ?? "").localeCompare(String(b.title ?? ""), undefined, { sensitivity: "base" });

  if (mode === "az") return list.sort(byTitle);
  if (mode === "longest" || mode === "shortest") {
    const sign = mode === "longest" ? -1 : 1;
    return list.sort((a, b) => sign * (totalChars(a) - totalChars(b)) || byTitle(a, b));
  }

  const read = mode.startsWith("positive") ? positiveRateOf : replyRateOf;
  const sign = mode.endsWith("-best") ? -1 : 1;
  return list.sort((a, b) => {
    const left = read(a);
    const right = read(b);
    // Unknown is not a score. It goes last whichever way the known values are pointing.
    if (left === null && right === null) return byTitle(a, b);
    if (left === null) return 1;
    if (right === null) return -1;
    return sign * (left - right) || byTitle(a, b);
  });
}
