// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Campaign } from "../../components/usePortal";

/**
 * When each campaign ran, on one horizontal scale.
 *
 * ── Where the end of a run comes from ───────────────────────────────────────────────────────────
 * HeyReach records when a campaign launched and never when it stopped, so an end date has to be
 * inferred. The newest message attributable to a campaign is the last evidence it did anything, and
 * that is what the bar ends on. Three cases follow, and the chart distinguishes them rather than
 * flattening them into one confident-looking bar:
 *
 *   · still active   → the bar runs to today and is left open on the right, because it has not ended
 *   · has activity   → a closed bar from launch to the last message
 *   · launch only    → a diamond at the launch date, because a duration would be invented
 *
 * ── Why it scrolls rather than fits ─────────────────────────────────────────────────────────────
 * Eight months squeezed into a panel width puts a three-week campaign at four pixels. A fixed scale of
 * so-many-pixels-per-day keeps every bar readable and lets the panel scroll, which is also how the
 * Airtable view this replaces behaves.
 */

/** Pixels per day. Wide enough that a one-week campaign is still a bar rather than a tick. */
const DAY = 3.4;
const DAY_MS = 86_400_000;

const startOfMonth = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

export default function Timeline({ campaigns }: { campaigns: Campaign[] }) {
  const scroller = useRef<HTMLDivElement | null>(null);

  const model = useMemo(() => {
    const dated = campaigns
      .filter((row) => row.launchedAt && !Number.isNaN(Date.parse(row.launchedAt)))
      .map((row) => {
        const start = Date.parse(row.launchedAt as string);
        const active = (row.status ?? "").toLowerCase() === "active";
        const last = row.lastActivityAt ? Date.parse(row.lastActivityAt) : NaN;
        const hasActivity = !Number.isNaN(last) && last > start;
        // An active campaign runs to now; a finished one to its last message; otherwise it is a point.
        const end = active ? Date.now() : hasActivity ? last : start;
        return { row, start, end, active, isPoint: !active && !hasActivity };
      })
      .sort((a, b) => a.start - b.start);

    if (!dated.length) return null;

    // The scale spans the first launch to whichever is later: the last end, or today.
    const first = startOfMonth(new Date(Math.min(...dated.map((d) => d.start))));
    const lastEnd = Math.max(...dated.map((d) => d.end), Date.now());
    const scaleEnd = new Date(Date.UTC(new Date(lastEnd).getUTCFullYear(), new Date(lastEnd).getUTCMonth() + 1, 1));

    const totalDays = Math.max(1, (scaleEnd.getTime() - first.getTime()) / DAY_MS);
    const width = totalDays * DAY;

    // One label per month, positioned on the same scale as the bars.
    const months: { label: string; left: number; span: number }[] = [];
    for (let cursor = new Date(first); cursor < scaleEnd; cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))) {
      const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
      months.push({
        label: cursor.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }),
        left: ((cursor.getTime() - first.getTime()) / DAY_MS) * DAY,
        span: ((next.getTime() - cursor.getTime()) / DAY_MS) * DAY,
      });
    }

    const x = (time: number) => ((time - first.getTime()) / DAY_MS) * DAY;
    return { rows: dated, width, months, x, today: x(Date.now()) };
  }, [campaigns]);

  // Open on today rather than on the oldest campaign — what ran this month is the usual question.
  useEffect(() => {
    if (!model || !scroller.current) return;
    const box = scroller.current;
    box.scrollLeft = Math.max(0, model.today - box.clientWidth * 0.62);
  }, [model]);

  if (!model) {
    return (
      <div className="panel tl-panel">
        <div className="panel-head cmp-head"><h2>Timeline</h2></div>
        <p className="empty">No campaign has a launch date recorded, so there is nothing to place on a timeline.</p>
      </div>
    );
  }

  return (
    <div className="panel tl-panel">
      <div className="panel-head cmp-head">
        <h2>Timeline</h2>
        <div className="tl-key">
          <span><i className="tl-key-bar" />Ran</span>
          <span><i className="tl-key-live" />Still running</span>
          <span><i className="tl-key-point" />Launch only</span>
        </div>
      </div>

      <div className="tl-scroll" ref={scroller}>
        <div className="tl-canvas" style={{ width: model.width }}>
          <div className="tl-ruler">
            {model.months.map((month) => (
              <span key={month.label} className="tl-month" style={{ left: month.left, width: month.span }}>
                {month.label}
              </span>
            ))}
          </div>

          <div className="tl-grid" aria-hidden="true">
            {model.months.map((month) => (
              <span key={month.label} className="tl-gridline" style={{ left: month.left }} />
            ))}
            <span className="tl-today" style={{ left: model.today }} />
          </div>

          <div className="tl-rows">
            {model.rows.map(({ row, start, end, active, isPoint }) => {
              const left = model.x(start);
              const days = Math.max(1, Math.round((end - start) / DAY_MS));
              const label = `${row.name} · launched ${new Date(start).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}${
                isPoint ? "" : active ? ` · running ${days} days` : ` · ran ${days} days`
              }`;

              if (isPoint) {
                return (
                  <div className="tl-row" key={row.campaignId || row.name}>
                    <span className="tl-point" style={{ left: left - 7 }} title={label} />
                    <span className="tl-point-label" style={{ left: left + 13 }}>{row.name}</span>
                  </div>
                );
              }

              return (
                <div className="tl-row" key={row.campaignId || row.name}>
                  <span
                    className={`tl-bar ${active ? "is-live" : ""}`}
                    style={{ left, width: Math.max(model.x(end) - left, 8) }}
                    title={label}
                  >
                    <span className="tl-bar-name">{row.name}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
