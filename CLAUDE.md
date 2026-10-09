# QC Portal: read this first

The client-facing portal for QC Growth, an outbound agency running LinkedIn campaigns through HeyReach.
Clients sign in to see QC's work for them. QC Command (repo `kirilQC/reply-radar`, replyradar.dev) is the
internal tool and the data source. Both use one Supabase database.

**Next.js 16 App Router, React 19, TypeScript, on Vercel · raw `fetch` to Supabase PostgREST with the
service key · no SDKs, no auth or chart libraries · live at https://www.qcgrowth.dev (also
qc-portal-mu.vercel.app)**

**Picking up cold?** The newest work is at the top of [`docs/changelog.md`](docs/changelog.md). Open items
are listed there under "Open".

| Read | For |
|---|---|
| [`README.md`](README.md) | What the product is, tabs, setup |
| [`docs/data-rules.md`](docs/data-rules.md) | **Every metric's definition.** Read before touching any number. |
| [`docs/security.md`](docs/security.md) | Tenant isolation: the choke point, the tests, how to add a route safely |
| [`docs/pages.md`](docs/pages.md) | Each screen, its files and its API route |
| [`docs/operations.md`](docs/operations.md) | Deploying, the database, the QC Command dependency, debugging a wrong number |
| [`docs/changelog.md`](docs/changelog.md) | What changed and why, newest first |

## The owner's standing priorities

1. **Data accuracy above everything.** Clients visit this. HeyReach is the source of truth. A wrong number
   is worse than a missing one: show "not synced yet", never a fake zero.
2. **Count only QC's work.** QC-coded campaigns only (`shared/campaign-code.mjs`). Conversations go through
   `app/lib/qc-conversations.ts`.
3. **Clients can never see each other's data.** Read only via `scopedRows`, `scopedCount` or
   `scopedByConversation` after `resolveScope`.
4. **Match QC Command.** Same definitions, same inbox, same lead drawer. Open both side by side in Chrome
   when changing either.
5. **Numbers consistent across pages.** One definition per figure (see data-rules).
6. **Hide empty things.** Tabs with no content are not shown, and empty sections are not rendered.

## How the owner likes to work

- **Push to `main` and verify live.** A push deploys. Wait for the commit status to read `success`, open the
  live page, confirm, and only then say it's done. Report what you could not verify.
- **When asked for designs, show options first** (the Artifact design canvas) and don't change the app until
  one is picked.
- Audits mean actually checking against HeyReach and QC Command in the browser, not reading code.

## Before every commit

```bash
npm run typecheck        # clean
npm run lint             # 0 errors (warnings ~18, baseline: <img>, exhaustive-deps)
npm test                 # all passing (123 at last count, 2026-10-09)
npm run watermark:check  # `npm run watermark` adds the header to new files
npm run build
```

Commit trailers:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: <session url>
```

## Gotchas

- **Route files cannot export extra names** (Next.js). Keep constants module-private.
- **No `Date.now()` or `Math.random()` during render.** React's lint fails on impure calls. Stamp the time in
  an effect or a load callback, or compute it on the server (see `sync.stale`).
- **`.page-scroll` has `zoom`.** Overlays that must render at true size use `createPortal(…, document.body)`
  (see `LeadProfileDrawer`).
- **New client-readable table**: add it to `CLIENT_READABLE` in `app/lib/db.ts` and the mirror in
  `tests/isolation.test.mjs`. The drift test checks both directions.
- **`rr_leads` select guard**: renamed `raw_data->…` paths throw unless they are the whole `reply_radar`,
  `ai_ark` enrichment, or the person's email fields.
- **QC Brain** is the GitHub repo `jsbiv18/qc-growth-os`, folder `clients/<folder>/`. The folder is resolved
  per workspace (`brain_folder`, else slug or name, else a guarded loose match).
- **The Claude connector** (`/api/mcp/brain/<token>`) is the one route with no session: middleware opens exactly
  one path segment, and the folder comes from the token only, never from the request. Writes go only to
  `clients/<folder>/from-client/`. Links are derived from `SESSION_SECRET`, so rotating it changes every
  client's link. See `docs/security.md`.
- **Don't block offboarded workspaces in the connector.** Bluevia has `offboarded_at` set but is an active
  portal client; a check on it broke its link. Access follows the portal's rules.
- **Vercel deploys sometimes don't trigger.** Push an empty commit.
- **The automation browser tab counts as hidden**, so animations, rAF and the starfield pause there. Verify
  motion by state or a single drawn frame, not by watching.

## Settled decisions (do not relitigate)

- Replies = conversations (people), not messages. Positive = latest reply in range judged positive.
- Stat badges show good news only. No red badges.
- Conversations with no campaign, or a non-QC campaign, are invisible to clients. They stay in QC Command
  and are not deleted.
- Offboarded clients keep syncing HeyReach analytics (QC Command worker).
- Tags are per client and separate from QC Command's internal tags.
- The reply calendar shows replies only, this month only, with a hover tip and no detail panel.
- The Appearance control lives in Settings. There is no top bar.
- The background is the starfield (option 2). The dot-grid ripple was tried and rejected.
- The lead profile copies QC Command's exactly, minus the Clients field, Enrich and delete/block.
