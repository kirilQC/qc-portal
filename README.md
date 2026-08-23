# QC Portal

The client-facing half of QC Growth's outbound operation. Reply Radar is the internal tool; this is what
the client sees — their campaigns, their replies, their meetings, their pipeline, and nothing else.

One website, every client, and a login that decides which one you are looking at.

---

## The one thing this product is

**A client can never see another client's data.** Everything below exists to make that true by
construction rather than by care.

There are three independent guards on it:

1. **The session cannot be edited.** The cookie carries signed claims — user, role, workspace, expiry —
   with an HMAC over them. Change one character of the workspace id and the signature stops matching.
   (`app/lib/session.ts`)
2. **There is only one way to read the database, and it scopes.** Every read goes through `scopedRows`,
   which derives the workspace filter from the session and discards any the caller supplies. A read with
   no session throws. A client reading a table that has no tenancy column is refused outright.
   (`app/lib/db.ts`)
3. **The database says so too.** `qc_portal_users` has a CHECK constraint that a `client` row must have a
   workspace and a `staff` row must not. (`supabase/portal-schema.sql`)

`tests/isolation.test.mjs` states each attack and asserts it fails. It also asserts the test file has not
drifted from `db.ts`. **Run it before every deploy.**

---

## Roles

| Role | Sees | How the scope is set |
|---|---|---|
| `staff` | Every client. Picks one from a directory. | No workspace on the session; `?client=` names who they are looking at |
| `client` | Exactly one company, always. | Workspace baked into the signed session; `?client=` is ignored entirely |

When staff view a client, they get the *same* scoped reads and the *same* components the client gets — so
the internal view of a client cannot drift from what the client is actually shown.

---

## What a client is shown

| Page | Source |
|---|---|
| Overview | Headline metrics + 30-day activity chart |
| Campaigns | `rr_campaign_stats` — reached, accepted, acceptance %, replies, reply % |
| Replies | `rr_conversations` + `rr_leads` — who replied, from where, when |
| Meetings | `rr_meetings` — upcoming and past, with company enrichment |
| Pipeline | `rr_deals` — deals with attribution strength shown per line |

**Deliberately not shown:** API keys, onboarding checklists, do-not-contact lists, AI scoring reasons,
internal Slack briefs, message transcripts. The complete list of what a client can reach is the allowlist
at the top of `app/lib/db.ts` — one file to audit, rather than every query in the app.

### Two conventions worth knowing

- **Acceptance** is out of requests *sent*. **Reply rate** is out of connections *accepted* — nobody can
  reply to a request that was never accepted. This matches Reply Radar exactly, so the client's portal and
  QC's internal tool never show two versions of the same percentage.
- **Attribution** is conservative. *Confirmed* means a specific person QC contacted or met is on the deal.
  *Possible* means only the company domain matched. Both are shown, labelled, and the headline figure is
  the confirmed one.

---

## Architecture

Same stack and the same house rules as Reply Radar: Next.js App Router, TypeScript, **raw `fetch` only —
no Supabase SDK, no auth library, no crypto library.** Password hashing and session signing are Web Crypto,
which works identically in Edge middleware and Node route handlers.

It reads the **same Supabase database** as Reply Radar. Nothing is duplicated or synced, so the portal is
never stale. It owns exactly one table of its own (`qc_portal_users`) and **writes nothing else** — a
read-only client surface cannot corrupt the operational data it renders.

```
middleware.ts          Deny-by-default gate. Open paths are listed; everything else needs a session.
app/lib/session.ts     Signed session claims (HMAC-SHA256). Expiry is inside the signature.
app/lib/password.ts    PBKDF2-SHA256, 210k iterations, per-password salt.
app/lib/db.ts          ★ The only way to read the database. Scoping lives here.
app/lib/portal-data.ts The exact set of fields a client may see.
app/lib/users.ts       Logins. Enumeration-resistant authentication.
```

---

## Setup

### 1. Environment variables

| Variable | What it is |
|---|---|
| `SESSION_SECRET` | **Required.** Long random string for signing sessions. With it unset, nothing can log in — the app fails shut. Generate: `openssl rand -hex 32` |
| `SUPABASE_URL` | Same value Reply Radar uses |
| `SUPABASE_SERVICE_ROLE_KEY` | Same value Reply Radar uses |
| `PORTAL_COOKIE_DOMAIN` | Optional. Set for a custom domain, e.g. `.qcgrowth.com` |
| `PORTAL_ROOT_DOMAIN` | Optional. Alternative to the above |

Rotating `SESSION_SECRET` signs everyone out immediately. That is the panic button.

### 2. Create the table

Run `supabase/portal-schema.sql` in the Supabase SQL editor.

### 3. Create the first staff account

Nobody can log in to create logins until one exists, so the first is made by hand:

```bash
npm run hash-password -- 'a long password you choose'
```

Paste the printed hash into the `insert` at the bottom of `supabase/portal-schema.sql`, set your email,
and run it. Then sign in and use **Logins** to create everyone else.

### 4. Everything after that is in the UI

**Logins → Add a login** creates a client account: pick the client, leave the password blank to have one
generated. The password is shown **once** — passwords are stored as hashes and cannot be read back. Send it
to them, then close the panel. Reset and switch-off are on every row.

---

## Development

```bash
npm run dev
npm test          # isolation + password. Run before every deploy.
npm run typecheck
npm run lint
npm run build
npm run watermark
```

---

## Known limits

- **RLS is not the wall.** Reply Radar's tables have row-level security enabled with zero policies, and
  every path uses the service role key, which bypasses it. So `app/lib/db.ts` *is* the wall today. Adding
  real per-tenant policies is the natural hardening step and would not break Reply Radar (the service role
  bypasses them), but it is not in place yet — which is why the choke point is written to be paranoid.
- **Sessions cannot be revoked individually.** Switching an account off takes effect immediately (the user
  row is re-checked on every `/api/me`), but an already-issued cookie stays cryptographically valid until it
  expires. A session table would fix this; it costs a database read per request.
- **Positive-reply counts are not surfaced yet.** The field exists and reads zero; wiring it needs the
  sentiment read from `rr_messages`.
- **No password reset by email.** Staff reset passwords from the Logins screen. Self-service needs an email
  sender, which would be the first real dependency.

---

Built by [Kiril Ivlev](https://www.linkedin.com/in/kiril-ivlev/) · proprietary, not licensed for
redistribution or resale.
