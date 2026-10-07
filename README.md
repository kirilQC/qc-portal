# QC Portal

The client-facing half of QC Growth's outbound operation. **QC Command** (the `reply-radar` repo, served at
replyradar.dev) is the internal tool the team works in; **QC Portal** is what each client signs into to see
the work QC is doing for them: who was reached, who replied, what was booked, what was discussed.

One website, every client, and a login that decides which one you are looking at.

- Live: **https://qc-portal-mu.vercel.app** (Vercel project `qc-portal`, deploys from `main`)
- Repo: **github.com/kirilQC/qc-portal**
- Data: the **same Supabase project** as QC Command. The portal reads QC Command's `rr_*` tables and owns a
  handful of `qc_portal_*` tables of its own.

> New to this repo, or starting a fresh session? Read [`CLAUDE.md`](CLAUDE.md) first, then
> [`docs/data-rules.md`](docs/data-rules.md). Every number a client sees is defined there.

---

## The three rules this product lives by

1. **A client can never see another client's data.** Enforced in code at one choke point, tested, and
   audited. See [`docs/security.md`](docs/security.md).
2. **Every number must match HeyReach**, the source of truth, and must count **only QC's work**. A
   client's own HeyReach campaigns, replies with no campaign, and days QC Command has not synced are
   never counted as QC's work. See [`docs/data-rules.md`](docs/data-rules.md).
3. **The portal and QC Command show the same thing.** Metric definitions, the inbox and the lead
   profile are reproduced from QC Command. When the two disagree, the portal is wrong.

---

## What a client sees

The sidebar shows only the tabs that have something in them. Empty tabs are hidden, not shown blank.

| Tab | What it is | Shown when |
|---|---|---|
| **Overview** | The client's name and the range picker sit inside an animated constellation hero. Below it: a typed weekly summary, a live "Just in" reply feed, 8 stat tiles with sparklines and good-news badges, the funnel for the range, the Activity chart (sending, replies and meetings), a this-month reply calendar, the last weekly call recap, and active campaigns with who is sending today. | Always |
| **Inbox** | QC Command's reply queue: metrics, filters, a custom date range, per-client tags, the conversation thread, the AI draft and sending. "View full profile" opens the lead drawer. | Always |
| **Database** | Every person QC's campaigns engaged, searchable. Opens the same lead profile drawer as QC Command. | Always |
| **Campaigns** | Each QC campaign as a funnel bar (not contacted, reached, accepted, replied, positive) with its rates. | Always |
| **Analytics** | QC Command's analytics page: eleven figures, daily requests, requests by sender, best and underperforming campaigns. | Always |
| **Meetings** | Booked meetings, upcoming first. | Always |
| **Messaging** | The client's campaign messaging sequences from QC Brain, joined to campaign results. "Messaging that performed best" is collapsed by default. | The client's QC Brain has at least one messaging doc |
| **Brain** | The client's QC Brain folder (brief, ICP, personas, voice, and so on) rendered as readable documents. | Always |
| **Weekly calls** | Recaps of the weekly calls, newest first, with the transcript folded away. | At least one call recap exists |
| **Project tracker** | QC Command's project board, read-only, showing only tasks staff marked "Show to client". | At least one visible task |

Staff also get **Clients** (the directory), **Admin** (logins and system health) and **Settings**. Settings
holds the account, team invites and Appearance (mode, zoom, font, time zone, colours), all saved per device.
The page-by-page detail is in [`docs/pages.md`](docs/pages.md).

---

## Roles

| Role | Sees | How the scope is set |
|---|---|---|
| `staff` | Every client, picked from the directory. Admin. | No workspace on the session; `?client=<slug>` or the `/<slug>/…` path says which client |
| `client` | Exactly one company, always. | Workspace baked into the signed session; any `?client=` is ignored |

When staff open a client, they get the same scoped reads and the same components the client gets. QC's view
of a client cannot drift from what the client is shown.

---

## Architecture

Next.js 16 (App Router), React 19, TypeScript. **Raw `fetch` only:** no Supabase SDK, no auth library, no
chart library. Sessions and password hashing use Web Crypto, so they work in middleware and in route
handlers alike. Charts are SVG and CSS drawn in-house.

```
middleware.ts                  Deny-by-default gate. Open paths are listed; /admin is staff-only.
app/lib/session.ts             Signed session cookie (HMAC-SHA256), expiry inside the signature.
app/lib/auth-context.ts        currentSession (re-checks the login is live) · resolveScope (client vs staff).
app/lib/db.ts                  ★ The only way to read the database. Scoping, allowlists, the raw_data guard.
shared/tenancy.mjs             Scrubs other clients' facts out of a lead's raw_data.
app/lib/qc-conversations.ts    ★ Which conversations are QC's work (QC-coded campaigns only).
shared/campaign-code.mjs       The "is this a QC campaign" rule, copied verbatim from QC Command.
app/lib/users.ts · password.ts Logins, PBKDF2 hashing, last-active tracking.
app/lib/brain*.ts              QC Brain (GitHub repo jsbiv18/qc-growth-os) reads, scoped to the client folder.
app/api/**                     One route per screen; every one resolves the scope first.
app/(portal)/**                The pages. OverviewApp.tsx is the overview; [client]/* are the tabs.
app/components/**              Shell (sidebar and nav gating), the lead drawer, skeletons, the starfield.
tests/*.test.mjs               Isolation, tenancy, campaign rule, parsers. Run before every deploy.
```

The full file map and the data flow from HeyReach through QC Command into the portal are in
[`docs/operations.md`](docs/operations.md).

---

## Setup

### Environment variables (Vercel → Settings → Environment Variables)

| Variable | Needed for |
|---|---|
| `SESSION_SECRET` | **Required.** Signs sessions. Unset means nobody can sign in (fails shut). Rotating it signs everyone out. `openssl rand -hex 32` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | **Required.** The same project QC Command uses. |
| `BRAIN_GITHUB_TOKEN` | Brain, Messaging and Weekly calls (reads the QC Brain repo). |
| `ANTHROPIC_API_KEY` | Laying out Brain documents for reading. |
| `CRON_SECRET` | The `/api/cron/health-alert` watchdog (Vercel cron sends it as a Bearer token). |
| `HEALTH_ALERT_SLACK_WEBHOOK` | Where the watchdog posts. |
| `HEYREACH_API_BASE` | Optional override for sending inbox replies. |
| `PORTAL_COOKIE_DOMAIN` / `PORTAL_ROOT_DOMAIN` | Optional, for a custom domain. |

`.env.example` lists them all. There is no production data locally; verify against the live site.

### Database

Run `supabase/portal-schema.sql` in the Supabase SQL editor. It is idempotent and creates the portal's own
tables: `qc_portal_users`, `qc_portal_messaging_links`, `qc_portal_health_state`,
`qc_portal_meeting_overrides`, `qc_portal_tags` and `qc_portal_tag_assignments`. The first staff login is
made by hand: `npm run hash-password -- '<password>'`, then paste the hash into the insert at the bottom of
the file. Everyone else is created from **Admin → Add a login**. The password is shown once and cannot be
read back.

### Deploying

Push to `main`. Vercel builds and deploys. If a push does not show up as a deployment, push an empty commit;
the Git connection has needed reconnecting once already. Always confirm the live site serves the change.

---

## Development

```bash
npm run dev               # local server (needs .env.local with the variables above)
npm test                  # 116 tests: isolation, tenancy, campaign rule, parsers, password
npm run typecheck         # clean
npm run lint              # 0 errors; ~18 warnings, all <img> or exhaustive-deps, baseline
npm run watermark:check   # every source file carries the header; `npm run watermark` adds it
npm run build
```

Every source file starts with:

```
// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.
```

---

## Known limits

- **RLS is not the wall.** QC Command's tables use the service role key, which bypasses row-level
  security, so `app/lib/db.ts` is the wall. It is written to fail closed and is covered by tests.
- **Sessions are long-lived cookies.** Switching a login off takes effect within 30 seconds (the login is
  re-checked), but there is no per-session revoke list. Rotating `SESSION_SECRET` signs everyone out.
- **No self-service password reset.** Staff reset passwords from Admin.
- **The portal depends on QC Command's worker** for HeyReach figures. If a client stops syncing, the portal
  says so (a notice and "not synced yet" days) rather than showing zeros. See
  [`docs/operations.md`](docs/operations.md).

---

Built by [Kiril Ivlev](https://www.linkedin.com/in/kiril-ivlev/) · proprietary, not licensed for
redistribution or resale.
