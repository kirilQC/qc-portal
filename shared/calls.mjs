// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * Reading a weekly call document.
 *
 * ── The shape these files actually have ─────────────────────────────────────────────────────────
 * Reply Radar writes them, so the structure is known rather than guessed: frontmatter carrying the
 * title, date, attendees, host, duration and whether the recap was posted to the client; then
 * `# Title — date`; then `## Recap`; then `## Transcript`, which is the whole machine transcription of
 * the call. The last of those is the reason this parser exists at all — the previous page concatenated
 * a five-point recap and several thousand words of raw transcript into one scroll.
 *
 * ── Why the recap is parsed rather than rendered ────────────────────────────────────────────────
 * The recap is strongly typed and was rendering as undifferentiated grey. It always has the same five
 * sections in the same order, any of which may be dropped: Campaigns, Deals, Action Items, Discussed,
 * Next Steps. Items are numbered, with at most one sub-point each. The prompt that generates them calls
 * Action Items "the most important section" and puts the owner first on every line precisely because
 * everybody reading is scanning for their own name — which is worth something on screen only if the
 * owner is pulled out and shown as one.
 *
 * ── Slack mrkdwn, not markdown ──────────────────────────────────────────────────────────────────
 * The recap is generated for Slack and stored as Slack sends it: `*bold*` with single asterisks,
 * `_italic_` with underscores, `:shortcode:` emoji, `<@U012ABCDE>` mentions, and headings written
 * `*:signal_strength: _Campaigns_ :signal_strength:*`. Rendered as markdown that is all literal
 * punctuation. Both spellings are accepted here, because a document that has been through a converter
 * on the way in should not stop parsing.
 */

/* ── Frontmatter ────────────────────────────────────────────────────────────────────────────── */

/**
 * Split a leading `---` fenced block off the front of a document.
 *
 * Same shallow reader the messaging documents use, and same bargain: a block that does not close is
 * treated as absent rather than swallowing the document, because losing metadata is recoverable and
 * losing the call notes is not.
 */
export function splitFrontmatter(markdown) {
  const text = String(markdown ?? "").replace(/^\uFEFF/, "");
  if (!/^---\s*\r?\n/.test(text)) return { meta: {}, body: text };

  const lines = text.split(/\r?\n/);
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (/^---\s*$/.test(lines[i])) { end = i; break; }
  }
  if (end === -1) return { meta: {}, body: text };

  const meta = {};
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    meta[match[1].toLowerCase()] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: lines.slice(end + 1).join("\n").replace(/^\s*\n/, "") };
}

/* ── People ─────────────────────────────────────────────────────────────────────────────────── */

/** "Kiril Ivlev, Kori Bivens, Charlie" → three names. */
export function parseAttendees(value) {
  return String(value ?? "")
    .split(/\s*[,;]\s*|\s+&\s+/)
    .map((name) => name.trim())
    .filter(Boolean);
}

/**
 * Up to two initials for a name.
 *
 * A single-word attendee — the documents genuinely contain "Charlie" — gets one letter rather than a
 * blank circle, which is the case a naive `split(" ")[0][0] + split(" ")[1][0]` throws on.
 */
export function initialsOf(name) {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * Is this attendee the host?
 *
 * The host field is a first name ("Kiril") while the attendee list carries full names ("Kiril Ivlev"),
 * so an equality check finds nobody. Matching on the first word is what actually joins them.
 */
export function isHost(name, host) {
  const first = (value) => String(value ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return Boolean(host) && first(name) === first(host);
}

/* ── Slack decoration ───────────────────────────────────────────────────────────────────────── */

/**
 * The shortcodes these recaps actually use.
 *
 * Only the ones the generator is told to use. An exhaustive emoji table is a dependency in all but name
 * and would rot the first time Slack renamed one; anything missing is left as its `:shortcode:` text,
 * which is visible and ugly and therefore reported rather than silently dropped.
 */
export const EMOJI = {
  signal_strength: "📶", moneybag: "💰", dart: "🎯", speech_balloon: "💬", calendar: "📅",
  thread: "🧵", handshake: "🤝", rocket: "🚀", fire: "🔥", warning: "⚠️", bulb: "💡",
  chart_with_upwards_trend: "📈", white_check_mark: "✅", pushpin: "📌", eyes: "👀", tada: "🎉",
  hourglass: "⌛", hourglass_flowing_sand: "⏳", page_facing_up: "📄", bell: "🔔",
};

/** Replace `:shortcode:` with its glyph, leaving unknown codes visible. */
export function resolveEmoji(text) {
  return String(text ?? "").replace(/:([a-z0-9_+-]+):/gi, (whole, name) => EMOJI[name] ?? whole);
}

/** Strip every Slack decoration from a line, leaving the words. */
export function plainText(text) {
  return resolveEmoji(String(text ?? ""))
    .replace(/<@[A-Z0-9]+(?:\|([^>]+))?>/g, (whole, label) => label ?? "")
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/[*_~`]/g, "")
    .trim();
}

/* ── The recap ──────────────────────────────────────────────────────────────────────────────── */

/**
 * The five sections a recap can contain, in the order the generator emits them.
 *
 * `tone` drives the colour on screen and `icon` is the fallback when the document's own emoji is
 * missing. Action Items is first in the rendered order rather than third — see `RENDER_ORDER`.
 */
export const SECTIONS = [
  { key: "campaigns", label: "Campaigns", icon: "📶", tone: "camp", match: /^campaigns?$/i },
  { key: "deals", label: "Deals", icon: "💰", tone: "deal", match: /^deals?$/i },
  { key: "actions", label: "Action items", icon: "🎯", tone: "act", match: /^action\s*items?$/i },
  { key: "discussed", label: "Discussed", icon: "💬", tone: "disc", match: /^discussed$/i },
  { key: "next", label: "Next steps", icon: "📅", tone: "next", match: /^next\s*steps?$/i },
];

/**
 * The order sections are shown in, which is not the order they are written in.
 *
 * Action items leads. The generator's own prompt calls it the most important section, and it is the one
 * thing on the page somebody might need to act on today.
 */
export const RENDER_ORDER = ["actions", "next", "campaigns", "deals", "discussed"];

/**
 * Match a line against the known section names, whatever decoration it is wearing.
 *
 * The emoji have to come off as well as the asterisks. A heading is written
 * `*:signal_strength: _Campaigns_ :signal_strength:*`, which reduces to `📶 Campaigns 📶` once the
 * shortcodes resolve — and that is not the string `Campaigns`, so every section was missed and a recap
 * came back with no sections at all.
 */
function sectionOf(line) {
  const bare = plainText(line)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!bare || bare.length > 40) return null;
  return SECTIONS.find((section) => section.match.test(bare)) ?? null;
}

/**
 * Pull the owner off the front of an action item.
 *
 * Only ever applied inside Action Items. Elsewhere it would misread ordinary copy — "Zeal investment
 * committee meets tomorrow" opens with a capitalised word too, and turning that into an owner chip
 * would be worse than showing no owner at all. The separator is required for the same reason: a name
 * has to be followed by a dash or a colon to count.
 */
export function splitOwner(text) {
  const line = String(text ?? "").trim();

  const mention = line.match(/^<@[A-Z0-9]+\|([^>]+)>\s*[—–:-]?\s*(.*)$/);
  if (mention) return { owner: mention[1].trim(), text: mention[2].trim() || line };

  const at = line.match(/^@([A-Za-z][\w'’.-]*(?:\s+[A-Z][\w'’.-]*)?)\s*[—–:-]\s*(.+)$/);
  if (at) return { owner: at[1].trim(), text: at[2].trim() };

  const named = line.match(/^([A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+)?)\s*[—–:]\s*(.+)$/);
  if (named) return { owner: named[1].trim(), text: named[2].trim() };

  // A bare "Kori " followed by an em dash is the common spelling; a hyphen is only accepted with
  // spaces round it, so "Follow-up" can never be read as an owner called "Follow".
  const dashed = line.match(/^([A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+)?)\s+-\s+(.+)$/);
  if (dashed) return { owner: dashed[1].trim(), text: dashed[2].trim() };

  // "Kori Bivens to send Josh and Tim a report" — no separator at all, which is how the recaps are
  // actually written, so every owner chip was coming back empty. The lowercase verb after "to" is what
  // keeps this safe: a name has to be followed by something that reads as an instruction, so
  // "Value Care Group to Watch" cannot become an owner and neither can a sentence about a company.
  const owes = line.match(/^([A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+)?)\s+(to\s+[a-z].*)$/);
  if (owes) return { owner: owes[1].trim(), text: owes[2].trim() };

  return { owner: null, text: line };
}

/**
 * Parse the recap into typed sections of numbered items.
 *
 * Anything before the first recognised heading is kept as `intro` rather than dropped: a recap that
 * opens differently than expected still has to show every word somebody wrote.
 */
export function parseRecap(recap) {
  const lines = String(recap ?? "").split(/\r?\n/);
  const intro = [];
  const sections = [];
  let current = null;
  let item = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;

    const heading = sectionOf(line);
    if (heading) {
      current = { ...heading, items: [] };
      sections.push(current);
      item = null;
      continue;
    }

    // "1. " opens an item; the numbering restarts in every section, so it is only a marker.
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (numbered && current) {
      const body = plainText(numbered[1]);
      if (!body) continue;
      item = current.key === "actions"
        ? { ...splitOwner(body), sub: null }
        : { owner: null, text: body, sub: null };
      current.items.push(item);
      continue;
    }

    // "• " is a sub-point of the item above it, never an item of its own.
    const bullet = line.match(/^\s*[•·]\s+(.*)$/);
    if (bullet && item) {
      const body = plainText(bullet[1]);
      if (body) item.sub = item.sub ? `${item.sub} ${body}` : body;
      continue;
    }

    // A loose line inside a section belongs to whatever it followed rather than being lost.
    const body = plainText(line);
    if (!body) continue;
    if (!current) { intro.push(body); continue; }
    if (item) item.text = `${item.text} ${body}`;
    else current.items.push({ owner: null, text: body, sub: null });
  }

  return {
    intro: intro.join("\n"),
    // Empty sections are dropped: the generator is told to omit a section with nothing in it, and an
    // empty card is worse than a missing one.
    sections: sections.filter((section) => section.items.length),
  };
}

/* ── The document ───────────────────────────────────────────────────────────────────────────── */

/** Split the body on its `## Recap` and `## Transcript` headings. */
function splitBody(body) {
  const lines = String(body ?? "").split(/\r?\n/);
  const buckets = { title: null, lead: [], recap: [], transcript: [] };
  let where = "lead";

  for (const line of lines) {
    const heading = line.match(/^##\s+(.*)$/);
    if (heading) {
      const name = plainText(heading[1]).toLowerCase();
      if (/^recap/.test(name)) { where = "recap"; continue; }
      if (/^transcript/.test(name)) { where = "transcript"; continue; }
    }
    const h1 = line.match(/^#\s+(.*)$/);
    if (h1 && !buckets.title) { buckets.title = plainText(h1[1]); continue; }
    buckets[where].push(line);
  }

  const tidy = (arr) => arr.join("\n").replace(/^\s*\n+/, "").replace(/\s+$/, "");
  return { title: buckets.title, lead: tidy(buckets.lead), recap: tidy(buckets.recap), transcript: tidy(buckets.transcript) };
}

/** Roughly how many words, for telling somebody what they are about to open. */
export function wordCount(text) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  return words.length;
}

/**
 * One weekly call, parsed.
 *
 * @param {string} markdown  the whole file, frontmatter included
 */
export function parseCall(markdown) {
  const { meta, body } = splitFrontmatter(markdown);
  const { title, lead, recap, transcript } = splitBody(body);

  const attendees = parseAttendees(meta.attendees);
  const host = meta.host ? String(meta.host).trim() : null;
  const duration = Number(meta.duration_min) || null;

  // The title heading carries the date appended to it; the frontmatter has the date on its own, so the
  // heading's copy of it is redundant and only makes the header read twice.
  const cleanTitle = String(meta.title || title || "Weekly call").replace(/\s*[—–-]\s*\d{4}-\d{2}-\d{2}\s*$/, "").trim();

  const { intro, sections } = parseRecap(recap || lead);

  return {
    title: cleanTitle,
    date: meta.call_date || null,
    postedTo: meta.posted_to || null,
    lastSynced: meta.last_synced || null,
    host,
    durationMinutes: duration,
    attendees: attendees.map((name) => ({ name, initials: initialsOf(name), host: isHost(name, host) })),
    intro,
    // Ordered for reading, not for writing — action items lead.
    sections: [...sections].sort((a, b) => RENDER_ORDER.indexOf(a.key) - RENDER_ORDER.indexOf(b.key)),
    transcript,
    transcriptWords: wordCount(transcript),
    /** Everything anybody committed to on this call, for the header count. */
    actionCount: sections.find((section) => section.key === "actions")?.items.length ?? 0,
  };
}
