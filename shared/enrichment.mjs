// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * Reading the AI enrichment blob without trusting its shape.
 *
 * ── Why every field goes through a reader ───────────────────────────────────────────────────────
 * `raw_data.reply_radar.ai_ark` is written by an enrichment provider, not by this codebase, and it is
 * not a stable contract: a field that is a string for one lead is an object for the next, and an array
 * for the one after that. The portal rendered `[object Object]` in the location field for exactly this
 * reason — `String({city: "Manila"})` is not an error, it is a plausible-looking wrong answer that
 * renders happily and reaches the client's screen.
 *
 * So nothing here reads a field directly. Every accessor states what it will accept and returns a
 * string or null, and an unexpected shape becomes "not recorded" rather than machine noise.
 */

/** A value that is genuinely a plain object, as opposed to null, an array, or a primitive. */
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * Any of the shapes a text field arrives in, reduced to a string.
 *
 * Accepts a string; a `{name}`/`{label}`/`{title}`/`{value}` wrapper; or an array of any of those,
 * joined. Anything else — a number, a nested structure with no obvious label — returns "".
 */
export function text(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
  if (isRecord(value)) {
    for (const key of ["name", "label", "title", "value", "text"]) {
      const found = text(value[key]);
      if (found) return found;
    }
  }
  return "";
}

/** Like {@link text}, but null rather than "" so a caller can render "Not recorded". */
export const textOrNull = (value) => text(value) || null;

/**
 * A location, which is the field that actually broke.
 *
 * Arrives as a plain string, or as an object keyed some combination of city / state / region /
 * country / countryCode / full / formatted. The parts are assembled in the order a person would say
 * them, de-duplicated (providers frequently repeat the region as the state), and a pre-formatted
 * `full`/`formatted` string wins outright when one is offered.
 */
export function locationLabel(value) {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) return locationLabel(value[0]);
  if (!isRecord(value)) return null;

  // `default` and `short` are what the enrichment provider actually sends — a full and an abbreviated
  // rendering of the same place. The others are defensive: providers change their minds.
  const preformatted =
    text(value.default) || text(value.short) || text(value.full) || text(value.formatted) || text(value.displayName);
  if (preformatted) return preformatted;

  const parts = [
    text(value.city) || text(value.locality),
    text(value.state) || text(value.region) || text(value.administrativeArea),
    text(value.country) || text(value.countryName) || text(value.countryCode),
  ].filter(Boolean);

  const seen = new Set();
  const unique = parts.filter((part) => {
    const key = part.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.length ? unique.join(", ") : null;
}

/** A URL, or null. Anything without a scheme is refused rather than rendered as a broken link. */
export function urlOrNull(value) {
  const raw = text(value);
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  // Bare domains are common in enrichment payloads and are safe to promote.
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(raw)) return `https://${raw}`;
  return null;
}

/**
 * One employer, with every role held there.
 *
 * The provider groups employment by company rather than listing flat roles — `positionGroups`, each
 * holding a company and a `profile_positions` array — which is the right shape, because "four titles at
 * one company over six years" is one story and four rows is not. A group carries its own date range as
 * a fallback for roles that do not state their own.
 *
 * Alias-tolerant throughout: the same feed has used `positions`, `position` and `profile_positions` for
 * the same field. A group with no company and no roles is dropped rather than rendered blank.
 */
export function positionGroup(value) {
  if (!isRecord(value)) return null;
  const company = isRecord(value.company) ? value.company : {};
  const groupDate = isRecord(value.date) ? value.date : {};
  const name = text(company.name) || text(value.company_name) || text(value.companyName) || text(company);

  const roles = list(value.profile_positions ?? value.positions ?? value.position)
    .map((entry) => {
      if (!isRecord(entry)) return null;
      const date = isRecord(entry.date) ? entry.date : {};
      const title = text(entry.title) || text(entry.name) || text(entry.role);
      if (!title) return null;
      const start = text(date.start) || text(groupDate.start);
      const end = text(date.end) || text(groupDate.end);
      return { title, start, end, current: !end, location: locationLabel(entry.location) ?? "", description: text(entry.description) || "" };
    })
    .filter(Boolean);

  if (!name && !roles.length) return null;
  return {
    company: name || "Company not recorded",
    logo: text(company.logo) || text(isRecord(company.logo) ? company.logo.source : "") || "",
    url: urlOrNull(company.url),
    start: text(groupDate.start),
    end: text(groupDate.end),
    roles,
  };
}

/**
 * One school.
 *
 * The provider's key is `educations`, and each entry names the school under any of three keys with the
 * degree and field of study under two more. Dates are frequently absent entirely, which is why they are
 * optional here rather than assumed.
 */
export function school(value) {
  if (!isRecord(value)) return null;
  const name = text(value.school_name) || text(value.school) || text(value.name) || text(value.institution);
  if (!name) return null;
  const date = isRecord(value.date) ? value.date : {};
  const degree = [text(value.degree_name) || text(value.degree), text(value.field_of_study)].filter(Boolean).join(", ");
  return {
    school: name,
    degree,
    start: text(date.start) || text(value.startDate) || text(value.starts_at) || "",
    end: text(date.end) || text(value.endDate) || text(value.ends_at) || "",
  };
}

/**
 * A headcount, as the provider states it: either a range, or a single known total.
 * "11–50 employees" · "1,240 known employees" · null when it says nothing.
 */
export function companySize(summary) {
  if (!isRecord(summary)) return null;
  const staff = isRecord(summary.staff) ? summary.staff : {};
  const range = isRecord(staff.range) ? staff.range : {};
  const start = text(range.start);
  const end = text(range.end);
  if (start || end) return `${start || "?"}–${end || "?"} employees`;
  const total = Number(staff.total);
  if (Number.isFinite(total) && total > 0) return `${total.toLocaleString("en-US")} known employees`;
  return null;
}

/** "Senior · Engineering · Platform" — the provider's seniority and function tags, tidied. */
export function departmentLabels(department) {
  if (!isRecord(department)) return [];
  const humanize = (value) => text(value).replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const parts = [
    department.seniority,
    ...list(department.functions),
    ...list(department.departments),
    ...list(department.sub_departments),
  ]
    .map(humanize)
    .filter(Boolean);
  return [...new Set(parts)];
}

/** An array field that might be a single item, a list, or absent. Always returns an array. */
export function list(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

/** A date range as a person would write it: "Jan 2021 — Present". */
export function rangeLabel(start, end, current) {
  const short = (iso) => {
    if (!iso) return "";
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return String(iso).slice(0, 7);
    // Formatted in UTC, because "2021-01-01" parses as UTC midnight and would render as December 2020
    // for anyone west of Greenwich. These are month-and-year labels; the local hour is meaningless.
    return parsed.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  };
  const from = short(start);
  const to = current && !end ? "Present" : short(end);
  if (!from && !to) return "";
  if (!from) return to;
  if (!to) return from;
  return `${from} — ${to}`;
}
