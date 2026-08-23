// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * The enrichment readers, tested against the shapes that actually turned up.
 *
 * The first test is the bug: a location object rendered as "[object Object]" on a real lead's screen.
 * `String(value)` on an object never throws, so nothing caught it — the wrong answer simply rendered.
 * These assert the reverse property: an unexpected shape produces nothing, never machine noise.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  companySize, departmentLabels, list, locationLabel, positionGroup, rangeLabel, school, text, urlOrNull,
} from "../shared/enrichment.mjs";

test("a location object never renders as [object Object]", () => {
  assert.equal(locationLabel({ city: "Manila", country: "Philippines" }), "Manila, Philippines");
  assert.equal(locationLabel({ city: "Austin", state: "Texas", country: "United States" }), "Austin, Texas, United States");
  assert.equal(locationLabel("Remote"), "Remote");
  assert.equal(locationLabel({ full: "Greater Manila Area" }), "Greater Manila Area");
  assert.equal(locationLabel(null), null);
  assert.equal(locationLabel({}), null);
  assert.equal(locationLabel({ unexpected: { nested: true } }), null);
});

test("a repeated region is said once", () => {
  // Providers routinely set state and region to the same value.
  assert.equal(locationLabel({ city: "London", state: "London", country: "United Kingdom" }), "London, United Kingdom");
});

test("text accepts every shape a provider sends and refuses the rest", () => {
  assert.equal(text("Growth Co"), "Growth Co");
  assert.equal(text({ name: "Growth Co" }), "Growth Co");
  assert.equal(text({ label: "Growth Co" }), "Growth Co");
  assert.equal(text(["A", "B"]), "A, B");
  assert.equal(text(42), "42");
  assert.equal(text({ nothing: { useful: 1 } }), "");
  assert.equal(text(null), "");
  assert.equal(text(undefined), "");
});

test("urls are only rendered when they are actually urls", () => {
  assert.equal(urlOrNull("https://growth.co"), "https://growth.co");
  assert.equal(urlOrNull("growth.co"), "https://growth.co");
  assert.equal(urlOrNull("not a url"), null);
  assert.equal(urlOrNull(""), null);
  assert.equal(urlOrNull({ city: "Manila" }), null);
});

test("an employer groups every role held there", () => {
  // The provider's real shape: a company plus profile_positions.
  const group = positionGroup({
    company: { name: "Acme", logo: "https://cdn/acme.png", url: "linkedin.com/company/acme" },
    date: { start: "2019-01-01", end: "2023-06-01" },
    profile_positions: [
      { title: "CTO", date: { start: "2021-02-01", end: "2023-06-01" } },
      { title: "Engineer", date: { start: "2019-01-01", end: "2021-02-01" } },
    ],
  });
  assert.equal(group.company, "Acme");
  assert.equal(group.url, "https://linkedin.com/company/acme");
  assert.equal(group.roles.length, 2);
  assert.equal(group.roles[0].title, "CTO");
  assert.equal(group.roles[0].current, false);
});

test("a role with no dates of its own inherits the employer's", () => {
  const group = positionGroup({ company_name: "Beta", date: { start: "2024-02-01" }, positions: [{ name: "Advisor" }] });
  assert.equal(group.company, "Beta");
  assert.equal(group.roles[0].start, "2024-02-01");
  assert.equal(group.roles[0].current, true, "no end date means they are still there");
});

test("an employer with neither a name nor a role is dropped", () => {
  assert.equal(positionGroup({ date: { start: "2021-01-01" } }), null);
  assert.equal(positionGroup("not an object"), null);
});

test("a school reads the provider's own key names", () => {
  const entry = school({ school_name: "MIT", degree_name: "BSc", field_of_study: "Computer Science" });
  assert.equal(entry.school, "MIT");
  assert.equal(entry.degree, "BSc, Computer Science");
  assert.equal(school({ name: "Oxford" }).degree, "");
  assert.equal(school({ degree: "BSc" }), null, "a degree with no school names nothing");
});

test("headcount reads as a range or a total, never as an object", () => {
  assert.equal(companySize({ staff: { range: { start: "11", end: "50" } } }), "11–50 employees");
  assert.equal(companySize({ staff: { total: 1240 } }), "1,240 known employees");
  assert.equal(companySize({ staff: {} }), null);
  assert.equal(companySize(null), null);
});

test("department tags are humanised and de-duplicated", () => {
  assert.deepEqual(
    departmentLabels({ seniority: "senior", functions: ["engineering"], departments: ["engineering"], sub_departments: ["platform_eng"] }),
    ["Senior", "Engineering", "Platform Eng"],
  );
  assert.deepEqual(departmentLabels(null), []);
});

test("list turns anything into an array", () => {
  assert.deepEqual(list(["a"]), ["a"]);
  assert.deepEqual(list("a"), ["a"]);
  assert.deepEqual(list(null), []);
  assert.deepEqual(list(undefined), []);
  assert.deepEqual(list(""), []);
});

test("date ranges read the way a person writes them", () => {
  assert.equal(rangeLabel("2021-01-01", "2023-06-01", false), "Jan 2021 — Jun 2023");
  assert.equal(rangeLabel("2021-01-01", "", true), "Jan 2021 — Present");
  assert.equal(rangeLabel("", "", false), "");
});
