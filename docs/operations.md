# Operations: deploying, the database, and QC Command

## Deploy

- `main` deploys to Vercel (project `qc-portal`, URL `qc-portal-mu.vercel.app`). A push is a release.
- After pushing, wait for the GitHub commit status to read `success`
  (`gh api repos/kirilQC/qc-portal/commits/<sha>/status --jq .state`), then confirm the live site serves
  the change before calling it done.
- If a push never shows up as a Vercel deployment, push an empty commit. If that also fails, the Git
  connection needs reconnecting (Vercel → project → Settings → Git); it was disconnected once.
- Cron (`vercel.json`): `/api/cron/health-alert` every 5 minutes.

## Database

- Supabase project `genkxyqvxggqskuqpbvf` (QC Growth), shared with QC Command.
- `supabase/portal-schema.sql` is the portal's schema, idempotent. Run new statements in the Supabase SQL
  editor. There are no migration files; the schema file is the record.
- Portal-owned tables: `qc_portal_users`, `qc_portal_messaging_links`, `qc_portal_health_state`,
  `qc_portal_meeting_overrides`, `qc_portal_tags`, `qc_portal_tag_assignments`.
- QC Command tables the portal reads (all scoped):
  - `rr_workspaces`
  - `rr_campaign_stats`
  - `rr_daily_stats`
  - `rr_conversations`
  - `rr_messages` (by conversation only)
  - `rr_leads`
  - `rr_lead_index`
  - `rr_meetings`
  - `rr_deals`
  - `rr_projects`
  - `rr_sync_runs`
  - `rr_webhook_events`
- There is no local `.env` with production values. Investigate data with read-only SQL in the Supabase
  editor, or with the live API from a signed-in browser.

## The QC Command dependency (repo `kirilQC/reply-radar`, replyradar.dev)

The portal shows what QC Command's worker and webhooks store. Things that live there, not here:

- **HeyReach sync** (`worker/render-worker.mjs`, Render service, deploys from that repo's `main`):
  - campaign stats and daily stats for **QC-coded campaigns only**
  - it **includes offboarded clients**
  - each client is refreshed about every 2 hours
- **The campaign rule** `shared/campaign-code.mjs`. The portal has a verbatim copy; keep them identical.
- **Workspace settings**: brain folder, messaging doc URL, call analysis, Granola title match. Set in QC
  Command → Admin and Slack.
- **Portal setup alerts**: each client's QC Command project management page lists what the portal is missing:
  - messaging doc not linked or not synced
  - weekly call recaps not set up, or stale over 14 days
  - no QC Brain folder

  This is `/api/project-management/setup-checks`, with an "Add as task" button.
- **Client-visible tasks**: "Show to client" on QC Command's board.

QC Command's own rules (lint baseline, no dashes in UI strings, `context/` docs) are in that repo's `CLAUDE.md`.

## When a number looks wrong

1. **Is the client synced?**
   `select max(refreshed_at), max(day) from rr_daily_stats where workspace_id = '<id>' and sender_id = ''`.
   The portal shows a stale notice when the data is more than a day behind.
2. **Is the key the client's own HeyReach account?** Compare the sender names in `rr_daily_stats` with the
   LinkedIn accounts in QC's HeyReach workspace for that client. Look for campaign names without QC codes.
3. **Is the campaign coded?** An uncoded QC campaign does not count; add the code in HeyReach.
4. **Force a refresh**: Analytics → Sync now (staff), or `POST /api/analytics/refresh?client=<slug>`.

## Known client situations (Oct 2026)

- **No HeyReach key**: Reach, Sourcebot, Bead, Misc.
- **Key rejected**: OhMD's key returns 401.
- **Own HeyReach account behind the key**:
  - CAMB: no QC campaigns yet, so the portal shows 0.
  - Willow and Cotool: offboarded, with QC campaigns finished or paused.
  - Hetz: a mix of QC and own campaigns.
- **No QC Brain folder** (Brain, Messaging and Weekly calls are empty): Arcjet, Autoheal, CAMB, Hetz, NOK,
  Sazabi, Topo.
- **`misc`** is QC's internal workspace and is hidden from the directory.
