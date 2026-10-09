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
  assert.match(lib, /if \(!name \|\| name\.includes\("\.\."\) \|\| name\.includes\("\\\\"\) \|\| name\.startsWith\("\."\)\)/);
  assert.match(lib, /export const CLIENT_CORNER = "from-client";/);
  // Reads go through the folder-scoped checks too.
  assert.match(lib, /readClientDoc\(folder, inFolder\(folder, relative\)\)/);
  assert.match(lib, /if \(!clean \|\| clean\.includes\("\.\."\)/);
});

test("the connector speaks MCP: initialize, tools/list, tools/call, and the four tools", () => {
  for (const method of ["initialize", "tools/list", "tools/call", "ping"]) assert.ok(route.includes(`method === "${method}"`), method);
  for (const tool of ["list_brain_files", "read_brain_file", "search_brain", "write_client_note"]) assert.ok(route.includes(`name: "${tool}"`), tool);
});
