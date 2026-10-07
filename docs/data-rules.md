# Data rules: what every number means

Clients read these numbers and quote them back. **Data accuracy is the first priority, ahead of design.**
HeyReach is the source of truth, and the portal counts only QC's work. If you change how a figure is
computed, update this file in the same commit.

---

## Where the data comes from

```
HeyReach ──(webhooks + Render worker, in QC Command)──► Supabase rr_* tables ──(scoped reads)──► QC Portal
                                                        QC Brain repo (GitHub) ──────────────► Brain, Messaging, Weekly calls
```

- **QC Command's Render worker** (`reply-radar/worker/render-worker.mjs`) pulls HeyReach stats into
  `rr_campaign_stats` (lifetime per campaign) and `rr_daily_stats` (day by day, one total row with
  `sender_id = ''` plus one row per sender). It rotates through clients; each refreshes about every 2 hours.
  Staff can force one from Analytics → **Sync now** (`/api/analytics/refresh`).
- **Replies** arrive by HeyReach webhook into `rr_conversations`, `rr_messages` and `rr_leads`.
- **Meetings** come from `rr_meetings`. Staff can override the count (`qc_portal_meeting_overrides`).
- The portal never calls HeyReach for figures. The one exception is sending an inbox reply.

---

## Rule 1: only QC's work counts

Some clients' HeyReach API keys are **their own HeyReach account**, where their team runs its own campaigns.
CAMB, Willow, Hetz and Cotool are examples. Everything those keys can see lands in the same tables.

**A campaign is QC's** when its name carries a QC code (`EM031v2`, `MS-12a`, `[PAUSED] EM031v2 …`) or says
`x QC`. The rule is `isOurCampaign` in `shared/campaign-code.mjs`, copied verbatim from QC Command's
`shared/campaign-code.mjs`. If one changes, change the other.

- **Campaign stats**: QC Command stores only QC campaigns.
- **Daily connections**: the worker asks HeyReach for QC campaign IDs only. A client with no QC campaign
  gets a window of zeros (CAMB shows 0, not its team's 110 requests a day).
- **Conversations**: `app/lib/qc-conversations.ts` decides which conversations are QC's. A conversation is
  QC's when any of its messages names a QC campaign. It is the only source for the inbox, reply counts,
  the Overview feed, chart and calendar, "waiting", the lead database and Analytics replies.
- A QC campaign launched **without a code** does not count. The fix is to add the code to the campaign name
  in HeyReach. There is no override list.

## Rule 2: an unsynced day is unknown, not zero

HeyReach reports every day in a range, zeros included. A day with no stored row is a day QC Command has
**not synced**.

- **Overview**: the connections line stops at the last synced day, the tooltip says "not synced yet", and a
  notice appears when the sync is more than a day behind (`sync.stale` from `/api/overview`).
- **Analytics**: unsynced days are dashed empty bars labelled "—".
- **Offboarded clients still sync analytics.** This changed on Oct 6 2026: Bluvia kept sending after its
  offboarding and its days read as 0.

## Rule 3: one definition per figure, everywhere

| Figure | Definition | Where |
|---|---|---|
| **Replies** (total) | People who replied to a QC campaign: the number of QC conversations. Not messages, and not HeyReach's per-campaign reply sum, which double-counts. | Overview tile, inbox "Replies all time", funnel "Replied" (all time) |
| **Replies in a range** | Distinct QC conversations with an inbound message in the range | Overview, inbox tiles, Activity |
| **Positive** | A conversation whose **latest** reply in the range was judged positive by QC Command | Everywhere |
| **Reached out to** | Connection requests sent: the sum of `connections_sent` in `rr_campaign_stats` (all time) or `rr_daily_stats` (a range) | Overview |
| **Acceptance rate** | accepted ÷ sent | Everywhere |
| **Reply rate** (Overview, a range) | replies ÷ reached, capped at 100%. A reply this week can come from someone who accepted weeks ago, so dividing by this week's accepts drifts past 100. | Overview |
| **Reply rate** (Overview, all time) | replies ÷ leads messaged (HeyReach's definition, as QC Command shows it) | Overview |
| **Reply rate** (Analytics, Campaigns) | replies ÷ **accepted**: nobody can reply to a request never accepted. Copied from QC Command. | Analytics, Campaigns |
| **Lead database** | People engaged by QC campaigns (the leads behind QC conversations) | Overview tile, Database |
| **Meetings booked** | Count of `rr_meetings`, or the staff override when one is set | Overview, Meetings |
| **Days of sending left** | leads still to contact ÷ (senders × the daily cap HeyReach reports, else 25) | Overview campaigns, Analytics |
| **Best / underperforming campaigns** | Split at the same average the tile above shows; a campaign is in one list or the other, never both | Analytics |

### Overview specifics

- The **range** (This week, This month, All time, Custom) drives the summary, the funnel, the Activity chart
  and the range tiles. The 8 stat tiles show all-time totals, with sparklines and badges for the range.
- **Badges are good news only.** "+384 this week", or "▲ 3.1 pts" when a rate beat the previous window.
  A rate that fell or held still gets no badge, never a red one.
- The summary sentence only adds "that is N% more replies" when replies went up.
- **Activity**: a week is drawn day by day. A month or all time uses a 7-day trailing average for replies
  (computed with the week before the range, so the first days are not part-week averages); the tooltip
  shows the real day as well. Meetings are pins on the day they were booked.
- **Reply calendar**: the current calendar month only, whatever the range. Shading is relative to the
  month's busiest day. Hovering a day shows replies and positive.
- **Just in feed**: real QC replies, newest first. People with no campaign or a non-QC campaign never appear.
- **Active campaigns**: "Morgan sending · 10 today" is the sender's sends today across all their
  campaigns, from the per-sender daily rows. The marker glows only when someone has sent today.

### Inbox specifics

- **Replies all time** is the server's exact count of QC conversations. Once any filter or search is on,
  every tile counts what is in view.
- Rows are QC conversations only, newest reply first. The queue loads the latest 600.
- **Tags** are per client (`qc_portal_tags`), created and applied by the client or by staff, and separate
  from QC Command's internal tags.

---

## Checking the numbers against HeyReach

1. In HeyReach (QC's account), switch to the client's workspace and open **Dashboard → Last 7 days**.
2. Compare Connections sent, Accepted and Replied with the portal's **This week**.
3. Hover single days on both charts to compare day by day. Days line up (no time-zone shift): Bluvia's Sep
   30 = 54, Oct 1 = 55 and Oct 5 = 50 matched exactly.
4. If they differ, check freshness first:
   `select max(refreshed_at), max(day) from rr_daily_stats where workspace_id = …`.
   Then check whether the client's key is their own HeyReach account (campaigns without QC codes).

Clients whose key is their own account (CAMB, Willow, Hetz, Cotool) will not appear in QC's HeyReach
workspace list, or will show different totals there. The portal intentionally shows QC's campaigns only.
