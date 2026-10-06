-- Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
-- QC Portal — proprietary. Not licensed for redistribution or resale.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- The QC Portal's own tables.
--
-- This app reads Reply Radar's tables (rr_*) but owns exactly one of its own: the people who may log
-- in. Prefixed qc_portal_ so it is obvious, in a shared Supabase project, which application owns it.
--
-- Everything else the portal shows — campaigns, replies, meetings, deals — already exists in the rr_*
-- tables and is read, never written, by this app. That is a deliberate constraint: a read-only client
-- surface cannot corrupt the operational data it renders.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════

create table if not exists qc_portal_users (
  id            uuid primary key default gen_random_uuid(),

  -- The login. Stored lowercased and trimmed by the application; unique so two accounts can never
  -- contend for the same address.
  email         text not null unique,

  -- PBKDF2-SHA256, in the self-describing format `pbkdf2$<iterations>$<salt-hex>$<hash-hex>`. Never a
  -- plaintext password, and never reversible — a forgotten password is reset, not recovered.
  password_hash text not null,

  -- 'staff'  → QC's own team. Sees every client.
  -- 'client' → one company. Sees exactly the workspace named below and nothing else, ever.
  role          text not null default 'client' check (role in ('staff', 'client')),

  -- The one client this login may read. Null for staff, required for clients — enforced below rather
  -- than left to the application, because this column is the entire security boundary of the product.
  workspace_id  uuid references rr_workspaces(id) on delete cascade,

  -- Who this is, for the greeting and for the staff user list.
  name          text not null default '',

  -- A login that is switched off keeps its history but cannot authenticate. Preferred over deleting,
  -- so that offboarding a client contact is reversible and leaves an audit trail.
  is_active     boolean not null default true,

  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- The rule that makes the role meaningful. A client row without a workspace could be read as
  -- "unscoped", which is precisely the bug this product cannot have; a staff row with a workspace would
  -- imply a restriction that the code does not honour. Both are refused at the database.
  constraint qc_portal_users_scope check (
    (role = 'client' and workspace_id is not null) or
    (role = 'staff'  and workspace_id is null)
  )
);

create index if not exists qc_portal_users_workspace_idx on qc_portal_users (workspace_id);
create index if not exists qc_portal_users_email_idx on qc_portal_users (lower(email));

-- Row-level security, on with no policies — the same posture as every rr_ table. All access is
-- server-side with the service role key, which bypasses RLS; the anon key therefore reads nothing.
-- The application-level wall (app/lib/db.ts) is what enforces tenancy, and it is written to be the
-- only route to the data precisely because this layer is permissive to the service key.
alter table qc_portal_users enable row level security;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────
-- The first staff account.
--
-- Run this once, replacing the hash, to create the account that can then create everyone else. Generate
-- the hash with `npm run hash-password -- 'your-password'` — never paste a plaintext password here,
-- because this file is committed.
-- ───────────────────────────────────────────────────────────────────────────────────────────────────
-- insert into qc_portal_users (email, password_hash, role, name)
-- values ('kiril@qcgrowth.com', 'pbkdf2$210000$...$...', 'staff', 'Kiril Ivlev')
-- on conflict (email) do nothing;

-- ── Manual campaign attribution for messaging documents ────────────────────────────────────────
--
-- The messaging tab joins a document to its campaign by name: an exact match on the campaign code,
-- then a similarity pass for the documents that carry no code. Neither can help a document whose name
-- shares nothing with the campaign it was written for, and there are several of those. This table is
-- where a human overrides the guess.
--
-- A row here always wins over whatever the matcher decided, and `campaign_id = null` is meaningful
-- rather than absent: it records "a person looked at this and it belongs to no campaign", which stops
-- the matcher re-suggesting a link that has already been rejected.
--
-- RLS on with no policies, like every other table here: the service key bypasses it and the app layer
-- is the wall. Writes are gated to staff in the route.
create table if not exists qc_portal_messaging_links (
  workspace_id  uuid not null,
  doc_path      text not null,
  campaign_id   text,
  set_by        text,
  set_at        timestamptz not null default now(),
  primary key (workspace_id, doc_path)
);

alter table qc_portal_messaging_links enable row level security;

create index if not exists qc_portal_messaging_links_workspace
  on qc_portal_messaging_links (workspace_id);

-- ── Health alert state ─────────────────────────────────────────────────────────────────────────
--
-- The alert job needs one bit of memory: what the health verdict was last time it ran, so it can post
-- to Slack only when the verdict *changes* — "went bad", "recovered" — rather than every few minutes.
-- A single row, keyed by a constant, holding the last verdict as JSON and when the last daily digest
-- was sent. RLS on with no policies like everything else; only the cron route (service key) touches it.
create table if not exists qc_portal_health_state (
  id            text primary key default 'singleton',
  last_verdict  jsonb,
  last_daily_at timestamptz,
  updated_at    timestamptz not null default now()
);

alter table qc_portal_health_state enable row level security;

-- ── Meetings-booked override ───────────────────────────────────────────────────────────────────
--
-- The "Meetings booked" figure a client sees is counted from rr_meetings, which only knows meetings that
-- reached QC Command (a calendar webhook, a manual log). Some are booked outside it — a call set up over
-- email, a meeting the client booked themselves off our intro — and staff need to be able to say the
-- real number. One row per client; a row present means "show this number instead of the count", and
-- deleting it hands the figure back to the automatic count. Portal-only: QC Command never reads it.
--
-- RLS on with no policies like every other table here: the service key bypasses it and the app layer is
-- the wall. Clients read their own row (it is their figure); only staff write, gated in the route.
create table if not exists qc_portal_meeting_overrides (
  workspace_id     uuid primary key,
  meetings_booked  integer not null check (meetings_booked >= 0),
  set_by           text,
  set_at           timestamptz not null default now()
);

alter table qc_portal_meeting_overrides enable row level security;

-- ── Inbox tags (per client) ─────────────────────────────────────────────────────────────────────
--
-- A client's own labels for conversations in the portal inbox ("Follow up in Q1", "Not a fit"). Each
-- client has its own list, managed by the client and by QC staff viewing that client; QC Command's
-- internal tags (rr_inbox_tag_assignments) are a separate, staff-only vocabulary and never shown here.
-- Assignments are at conversation grain, the id the inbox selects on.
--
-- RLS on with no policies like every table here: the service key bypasses it and the app layer is the
-- wall. Every write is scoped to the session's workspace in /api/inbox/tags, which also checks that the
-- conversation and the tag both belong to that workspace before linking them.
create table if not exists qc_portal_tags (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  name          text not null check (char_length(name) between 1 and 40),
  color         text not null,
  created_at    timestamptz not null default now(),
  unique (workspace_id, name)
);

create table if not exists qc_portal_tag_assignments (
  workspace_id     uuid not null,
  conversation_id  uuid not null,
  tag_id           uuid not null references qc_portal_tags(id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (conversation_id, tag_id)
);

create index if not exists qc_portal_tag_assignments_workspace on qc_portal_tag_assignments (workspace_id);

alter table qc_portal_tags enable row level security;
alter table qc_portal_tag_assignments enable row level security;
