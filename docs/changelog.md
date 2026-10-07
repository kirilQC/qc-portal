# Changelog

Newest first. The why behind each change, so a later session does not undo it. Commit hashes are in `git log`.

## Oct 6–7, 2026

### Data accuracy
- **QC's campaigns only, everywhere.** Some clients' HeyReach keys are their own account. CAMB showed its
  team's ~110 requests a day as QC's work despite having no QC campaign.
  - QC Command's worker now asks HeyReach for QC campaign IDs only.
  - The portal reads conversations through `lib/qc-conversations.ts`. The inbox, replies, feed, chart,
    calendar, lead database and Analytics replies count QC campaigns only.
  - Affected: CAMB, Willow, Hetz, Cotool, Ema (3 conversations) and Moss (3).
- **Unsynced days are not zeros.** Bluvia was offboarded on Oct 3, sync stopped, and Oct 4–6 read as 0
  while HeyReach showed 50 on Oct 5.
  - The chart now stops at the last synced day and a notice appears.
  - Analytics shows dashed bars for unsynced days.
  - The worker keeps syncing offboarded clients.
- **No-campaign conversations** are hidden from the inbox and the feed.

### Security
- **Isolation audit, route by route: no cross-client path found.** Hardening that came out of it:
  - the `rr_leads` `raw_data` select guard
  - the lead-level campaign/sender scrub
  - the loose Brain-folder match guard
  - a public `/api/health` reduced to ok/ready
  - two-way allowlist drift test
- **Last active is accurate.** The timestamp write is awaited (fire-and-forget writes were lost on
  serverless) and refreshed while a session is in use.

### Product
- **Admin**:
  - redesign: a counts bar, filter, search and client logos
  - "Last active" in plain words
- **Navigation**:
  - Messaging, Weekly calls and Project tracker are hidden when empty
  - no brand mark when the sidebar is collapsed
  - Appearance moved into Settings
- **Overview**:
  - header inside the constellation, with a bigger logo and name
  - typed summary
  - sparklines and good-news badges
  - Activity chart draws in, with meeting pins and a live today dot
  - reply calendar for this month, with a hover tip
  - Last weekly call ("What we discussed")
  - active campaigns showing who is sending today
- **Background**: the starfield with shooting stars.
- **Inbox**:
  - per-client tags
  - custom date range instead of Follow-ups
  - filters close on an outside click
  - "View full profile"
  - larger uniform row text
  - the draft matches the thread's text size
- **Lead profile**: rebuilt as QC Command's drawer with its own styles.
- **Messaging**: "performed best" is collapsed by default.

### Also in QC Command (reply-radar)
- `/api/project-management/setup-checks` and the alerts on each client's project page.
- Analytics collected for offboarded clients.
- Daily stats for QC campaigns only.

## Before Oct 6, 2026 (summary)

- Initial portal:
  - signed sessions and the scoped read path
  - client directory and Overview
  - Campaigns, Meetings, Inbox, Database, Analytics, Brain, Messaging, Weekly calls
- Metric unification with QC Command:
  - Replies = conversations
  - one positive definition
  - Best and Underperforming made exclusive
- Project tracker tab (read-only, curated), staff meetings override, legacy slugs kept working.
- HeyReach parity audit across all workspaces; Vercel Git connection repaired.
