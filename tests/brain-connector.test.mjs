// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lib = readFileSync(new URL("../app/lib/brain-connector.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/mcp/brain/[token]/route.ts", import.meta.url), "utf8");
const mw = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");

test("only the connector path is open without a session, and only one segment deep", () => {
  const rule = /\/\^\\\/api\\\/mcp\\\/brain\\\/\[\^\/\]\+\$\//;
  assert.match(mw, rule);
  const open = (p) => /^\/api\/mcp\/brain\/[^/]+$/.test(p);
  assert.ok(open("/api/mcp/brain/qcb_abc"));
  assert.ok(!open("/api/mcp/brain"));
  assert.ok(!open("/api/mcp/brain/x/y"));
  assert.ok(!open("/api/brain/connector"));
});

test("the link is stored only as a hash, and a client's folder comes from the link, never from a request", () => {
  assert.match(lib, /token_hash: hash\(token\)/);
  assert.doesNotMatch(lib, /token: token,|token_plain|\btoken: \w+, last4/);
  assert.match(lib, /token_hash: `eq\.\$\{hash\(token\)\}`/);
  assert.doesNotMatch(route, /folder.*params\.|args\.folder|searchParams/);
});

test("writes land only in from-client/ inside the client's own folder", () => {
  assert.match(lib, /const path = `clients\/\$\{connector\.folder\}\/\$\{CLIENT_CORNER\}\/\$\{name\}`;/);
  assert.match(lib, /if \(!name \|\| name\.length > 200 \|\| name\.includes\("\.\."\) \|\| !SAFE_PATH\.test\(name\)/);
  assert.match(lib, /export const CLIENT_CORNER = "from-client";/);
  // Reads go through the folder-scoped checks too.
  assert.match(lib, /readClientDoc\(folder, inFolder\(folder, relative\)\)/);
  assert.match(lib, /if \(!clean \|\| clean\.length > 300 \|\| clean\.includes\("\.\."\)/);
});

test("the connector speaks MCP: initialize, tools/list, tools/call, and the four tools", () => {
  for (const method of ["initialize", "tools/list", "tools/call", "ping"]) assert.ok(route.includes(`method === "${method}"`), method);
  for (const tool of ["list_brain_files", "read_brain_file", "search_brain", "write_client_note"]) assert.ok(route.includes(`name: "${tool}"`), tool);
});

test("hardening: plain path characters only, segments encoded, rate and size limits, safe link schemes", async () => {
  assert.match(lib, /const SAFE_PATH = \/\^\[\\p\{L\}\\p\{N\} _\.,'&\(\)\+\\-\/\]\+\$\/u;/);
  assert.match(lib, /const repoPath = \(path: string\) => path\.split\("\/"\)\.map\(encodeURIComponent\)\.join\("\/"\);/);
  assert.match(lib, /if \(write && entry\.writes > 60\)/);
  assert.match(route, /if \(raw\.length > 1_000_000\)/);
  assert.match(route, /body\.length > 20/);
  const { parseInline } = await import("../shared/markdown-blocks.mjs");
  const kinds = (t) => parseInline(t).map((s) => s.kind + (s.href ? `:${s.href}` : ""));
  assert.ok(!kinds("[a](javascript:alert(1))").some((k) => k.startsWith("link")));
  assert.ok(!kinds("[c](data:text/html,x)").some((k) => k.startsWith("link")));
  assert.ok(!kinds("[f](//evil.com)").some((k) => k.startsWith("link")));
  assert.deepEqual(kinds("[d](https://ok.com)"), ["link:https://ok.com"]);
});

test("pentest follow-ups: client-style write paths fold into the client's own corner, new notes list at once", () => {
  assert.match(lib, /\.replace\(\/\^clients\\\/\[\^\/\]\+\\\/\/, ""\)\.replace\(new RegExp\(`\^\$\{CLIENT_CORNER\}\/`\), ""\)/);
  assert.match(lib, /forgetBrainTree\(\);\n {2}return \{ path:/);
  const fold = (r) => r.trim().replace(/^\/+/, "").replace(/^clients\/[^/]+\//, "").replace(/^from-client\//, "");
  assert.equal(fold("clients/hyperpath/pwned.md"), "pwned.md");
  assert.equal(fold("/clients/bluevia-health/from-client/notes.md"), "notes.md");
  assert.equal(fold("clients/x/../y.md").includes(".."), true); // still refused by the ".." check
});

test("every client gets a link without asking: derived from the secret and when it was made, only the hash kept", () => {
  assert.match(lib, /createHmac\("sha256", secret\)\.update\(`qc-brain-link\|\$\{workspaceId\}\|\$\{Date\.parse\(madeAt\)\}`\)/);
  assert.match(lib, /export async function linkFor\(/);
  assert.doesNotMatch(lib, /token_plain|randomBytes/);
  const api = readFileSync(new URL("../app/api/brain/connector/route.ts", import.meta.url), "utf8");
  assert.match(api, /const token = await linkFor\(workspaceId/);
  assert.match(api, /"Cache-Control": "no-store"/);
});

test("link previews: only a client's name and logo, read from the login redirect's next", async () => {
  const preview = readFileSync(new URL("../app/lib/link-preview.ts", import.meta.url), "utf8");
  const login = readFileSync(new URL("../app/login/page.tsx", import.meta.url), "utf8");
  assert.match(mw, /\/\^\\\/api\\\/og\\\/\[a-z0-9-\]\+\$\//);
  assert.match(preview, /select: "slug,name,logo_url"/);
  assert.match(login, /previewClient\(slugFromNext\(/);
  const slugFromNext = (next) => { if (!next.startsWith("/") || next.startsWith("//")) return ""; const f = next.split(/[/?#]/)[1] ?? ""; return /^[a-z0-9][a-z0-9-]{0,63}$/.test(f) && !["admin","login","api","settings","account"].includes(f) ? f : ""; };
  assert.equal(slugFromNext("/bluevia/inbox?x=1"), "bluevia");
  assert.equal(slugFromNext("/admin"), "");
  assert.equal(slugFromNext("//evil.com/x"), "");
  assert.equal(slugFromNext("/../etc"), "");
});
