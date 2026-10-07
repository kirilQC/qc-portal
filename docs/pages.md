# Pages: what each screen does and where it lives

Paths are relative to the repo root. `[client]` is the client's slug (`/ema/inbox`). Staff reach any client;
a client session is pinned to its own.

## Shell (every page)

- `app/components/Shell.tsx`: the sidebar.
  - **Nav gating**: Messaging, Weekly calls and Project tracker only appear when the client has a messaging
    doc, a call recap, or a client-visible task. They share the cached URL with their own page.
  - **Collapsed sidebar**: no brand mark, just the expand button.
  - **Appearance**: applies the saved look on load.
- `app/components/AppBackground.tsx`: the starfield and shooting stars behind every page (one canvas). It
  pauses in background tabs, draws one still frame with reduced motion, and is hidden in light mode.
- `app/components/SettingsPanel.tsx` with `Appearance.tsx`: account, invite a colleague (clients), and
  Appearance (mode, zoom, font, dashboard time zone, background, accent), saved per device. There is no top bar.
- `app/components/cache.ts` `useCachedJson`: shows the last response instantly while it refreshes.

## Overview: `app/(portal)/OverviewApp.tsx`, `/api/overview`

Top to bottom:

1. **Hero** (`app/components/ActivityNetwork.tsx`, variant `hero`):
   - The client's logo, name and range buttons (This week, This month, All time, Custom via
     `DateRangePicker.tsx`) sit inside the constellation.
   - The summary sentence types itself in (`TypedText.tsx`).
   - "Just in" shows real replies, and pulses travel the network as they land.
2. **8 stat tiles**: sparklines for the range and good-news-only badges.
3. **Range funnel**: reached, accepted, replied, positive.
4. **Activity** (`ActivityChart.tsx`): two panels, connections sent on top and replies, positive and meeting
   pins below. Lines draw in, today pulses, and unsynced days are "not synced yet".
5. **Reply calendar** (`ReplyCalendar.tsx`): this month's heat map, with a hover tip showing replies and
   positive. Next to it, **Last weekly call** (`CallRecap.tsx`): date, length, summary and "What we
   discussed" from the newest recap.
6. **Active campaigns**: bars grow in, the work-front marker, and "<sender> sending · N today".

The page refreshes itself every 2 minutes while visible. A stale-sync notice shows when HeyReach data is
more than a day behind. Staff can edit **Meetings booked** in place (`/api/admin/meetings-override`).

## Inbox: `app/(portal)/[client]/inbox/page.tsx`, `/api/inbox`

- Reproduces QC Command's inbox. `inbox-command.css` is QC Command's measured styles over `inbox.css`.
- **Header**: 5 metric tiles. Range buttons (Today, This week, All replies) plus a Custom date range.
  Filters (campaign, sender, sentiment, tier, tag, sort, starred) close on an outside click or Escape.
- **Queue**: rows with 12.5px uniform text.
- **Detail pane**: lead, tags, "View full profile →", thread, AI draft (same text size as the thread) and send.
- **Tags**: `/api/inbox/tags`, per client, with colour chips, the "+ Tag" popover, and create, delete and filter.
- **Sending**: `/api/inbox/reply` sends through HeyReach after a confirm press.

## Database: `[client]/database/page.tsx`, `/api/leads`

QC-engaged leads, searchable and sortable, paged 50 at a time. A row opens the **lead profile drawer**.

## Lead profile drawer: `app/components/LeadProfileDrawer.tsx`, `/api/leads/[leadId]`

- QC Command's drawer, rendered on `<body>` at QC Command's size, using `qc-lead.css` (QC Command's own
  compiled styles, scoped `.qc-lead`).
- **Overview tab**: contact information, professional profile, current company, experience and education.
- **Activity tab**: each conversation with its campaign and sentiment, then the thread.
- **Deliberately omitted**: the cross-client "Clients" field, the phone "Enrich" button (it spends credits),
  and delete/block.

## Campaigns: `[client]/campaigns/page.tsx` (+ `Timeline.tsx`), `/api/portal`

Each QC campaign is a funnel bar (not contacted, reached, accepted, replied, positive) with its rates. Each
bar is proportional to its own audience.

## Analytics: `[client]/analytics/page.tsx`, `/api/analytics`

QC Command's analytics page:

- eleven figures
- requests per day, with unsynced days dashed
- requests by sender
- best and underperforming campaigns, split at the shown average

**Sync now** is staff-only and queues a worker pass.

## Meetings: `[client]/meetings/page.tsx`

`rr_meetings`, upcoming soonest first, then past.

## Messaging: `[client]/messaging/page.tsx`, `/api/messaging`

- The client's `Campaign messaging/*.md` in QC Brain, parsed into sequences and joined to campaign results.
- "Messaging that performed best" is collapsed by default.
- Staff can link a doc to a campaign by hand (`/api/messaging/link`, table `qc_portal_messaging_links`).

## Brain: `[client]/brain/page.tsx`, `/api/brain*`

- The client's QC Brain folder (repo `jsbiv18/qc-growth-os`, `clients/<folder>/`), shaped as the standard
  skeleton: Brief, ICP, Personas, Voice, Engagement, Pipeline, Do-not-contact.
- Documents are laid out for reading with Claude (`brain-render`, needs `ANTHROPIC_API_KEY`).
- Raw files and a zip download are available.

## Weekly calls: `[client]/calls/page.tsx`, `/api/brain-docs?folder=calls`

Recaps in `clients/<folder>/Weekly calls/`, parsed by `shared/calls.mjs`. Action items lead and the
transcript is folded away.

## Project tracker: `[client]/projects/*`, `/api/projects`

QC Command's board, read-only, with only `rr_projects.client_visible` tasks and safe columns. Staff use the
QC Command board to choose what is visible.

## Admin (staff): `app/(portal)/admin/page.tsx`, `/api/admin/users`; `admin/ops`, `/api/admin/ops`

- **Logins**:
  - One bar with counts (staff, client logins, active this week, never signed in), a filter and search.
  - Client logins show the client's logo.
  - **Last active** is real usage, shown as "12m ago", with the exact time on hover.
  - Add, reset, switch off and delete. A new password is shown once.
- **System health**: per-client sync and webhook freshness. The `/api/cron/health-alert` watchdog posts
  changes and a daily all-clear to Slack.

## Login: `app/login/page.tsx`, `/api/auth/login`

Throttled. Sets the signed cookie.
