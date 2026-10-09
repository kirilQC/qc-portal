# Security: one client can never see another's

The portal shares one Supabase database with QC Command and every client. The service role key bypasses
row-level security, so **the app layer is the wall**. It is built to fail closed, and it was last audited
route by route on Oct 6 2026: no path lets a client read or change another client's data.

## The layers

1. **Signed session** (`app/lib/session.ts`). An HMAC-SHA256 cookie carries the user, role, workspace and
   expiry. Editing any part breaks the signature.
2. **Live login check** (`app/lib/auth-context.ts` `stillLive`). The login must still exist, be active,
   and have the same role and workspace. Cached for 30 seconds per user, so a switched-off login stops
   working within 30 seconds. The same check refreshes "last active" at most every 10 minutes.
3. **Scope** (`resolveScope`). A client session always reads its own workspace; `?client=` is ignored.
   Staff name a client by slug.
4. **The only read path** (`app/lib/db.ts`):
   - `scopedRows` and `scopedCount` add the workspace filter from the session and drop any `workspace_id`
     the caller passes.
   - A client may read only tables in `CLIENT_READABLE`; `STAFF_ONLY` tables throw.
   - Messages and scores (`CONVERSATION_CHILDREN`) can only be read by `scopedByConversation`, which first
     proves every conversation ID belongs to the scope.
   - **On `rr_leads`, renamed `raw_data` paths are refused**, except the whole `reply_radar` object,
     `ai_ark` enrichment and the person's own email fields. The cross-client scrub only recognises those keys.
5. **Cross-client scrub** (`shared/tenancy.mjs`). A lead's `raw_data` can carry attributions and rollups
   from every client who contacted that person. They are cut to the reading workspace. Lead-level "latest
   campaign" and "latest sender" are removed unless they are the reader's own.
6. **Database constraint.** A `client` row in `qc_portal_users` must have a workspace and a `staff` row must not.
7. **Middleware** (`middleware.ts`). Deny by default. Open paths are `/login`, `/api/auth/*`, `/api/health`
   and `/api/cron/health-alert` (which checks `CRON_SECRET` itself). `/admin` and `/api/admin/*` are
   staff-only, and every admin route checks the role again.

## Route by route

Every client-reachable route resolves the scope first. The writes are:

- **Tags** (`/api/inbox/tags`): the tag and the conversation are both proved to be the session's before any write.
- **Send a reply** (`/api/inbox/reply`): the conversation is proved by a scoped read; it needs
  `confirm: "send"`; an identical message within 24 hours is refused.
- **Account** (`/api/account`): only the signed-in user's own row; invites are pinned to the session's
  role and workspace.

The Brain routes resolve the client's folder from the session, never the URL. `assertClientPath` rejects
`..` and anything outside `clients/<folder>/`. A loose folder-name match only stands when no other client
claims that folder more directly.

`/api/health` is public and returns only `{ ok, ready, database }`. Staff get the full diagnosis.

## The Claude connector (`/api/mcp/brain/<token>`)

A client's own Claude reads their brain through this route, so it has **no session**. What keeps it to one
client:

- **The link is the key.** `qcb_` + an HMAC of the workspace id and when the link was made, keyed by
  `SESSION_SECRET`. Only its SHA-256 hash is stored (`rr_brain_connectors`). Reset makes a new one and the
  old one stops working. A malformed or unknown token is 401 before anything else runs.
- **Middleware opens exactly one segment** (`/^\/api\/mcp\/brain\/[^/]+$/`); nothing below it is open.
- **The folder comes from the token**, never from the request. Every read path goes through `inFolder`
  (a leading `clients/<x>/` is stripped, so naming another client's folder looks inside the caller's own;
  `..`, empty segments and anything outside plain file-name characters are refused; segments are encoded one
  by one) and then `assertClientPath`.
- **Writes** go only to `clients/<folder>/from-client/<name>`: `.md`/`.txt`, no hidden files, at most 200,000
  characters, committed as "QC Portal (client)". QC's own documents can't be changed.
- Limits: 1 MB request, 20 messages per batch, 600 calls and 60 writes per hour per link per instance.
- QC Command treats `from-client/` text as untrusted client input for its assistants.

**Pentest, 2026-10-09 (Bluevia's live link):** 28 traversal and encoding payloads against a real Hyperpath
file, search for 8 other client names, 22 write-escape names, tampered tokens, oversize bodies and batches,
30 parallel calls. No cross-client read or write; every write landed in `clients/bluevia-health/from-client/`
(test notes deleted afterwards). Covered by `tests/brain-connector.test.mjs`.

## Tests

`tests/isolation.test.mjs` states each attack and asserts it fails:

- foreign workspace
- widened scope
- foreign conversation IDs
- staff-only tables
- the `rr_leads` raw_data rule

It also checks both directions of the allowlist mirror against `db.ts`. `tests/tenancy.test.mjs` covers the
scrub. **Run `npm test` before every deploy.**

## Before you add a route

- Call `resolveScope(slug)` first and read only through `scopedRows`, `scopedCount` or `scopedByConversation`.
- A new `qc_portal_*` table goes into `CLIENT_READABLE` in `db.ts` **and** the mirror in
  `tests/isolation.test.mjs` (the drift test fails otherwise), with a test showing a client reads only its own.
- Never select a renamed `raw_data->…` path on `rr_leads` beyond the allowed ones.
- Writes use `adminWrite`, and must prove ownership with a scoped read first.
