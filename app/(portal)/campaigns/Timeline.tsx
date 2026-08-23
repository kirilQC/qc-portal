// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";
/* eslint-disable react-hooks/set-state-in-effect -- the clock is read once on mount; it cannot be
   read during render without making the window depend on when React re-rendered. */

import { useEffect, useMemo, useState } from "react";
import type { Campaign } from "../../components/usePortal";

/**
 * When each campaign ran, on one horizontal scale.
 *
 * ── Why a name column rather than labels on the bars ────────────────────────────────────────────
 * The first version put a diamond on the canvas with its label floating to the right of it, which meant
 * nothing lined up: a reader tracking a campaign across the chart had no row to follow, and short
 * campaigns became a staircase of text at different heights. Names now live in a fixed column that does
 * not scroll away, every row is a banded lane, and the grid runs the full width of the panel rather than
 * stopping wherever the last bar happened to end.
 *
 * ── Where the end of a run comes from ───────────────────────────────────────────────────────────
 * HeyReach records when a campaign launched and never when it stopped, so an end has to be inferred.
 * The newest message attributable to a campaign is the last evidence it did anything. Three cases, drawn
 * differently rather than flattened into one confident bar:
 *
 *   · still active   → the bar runs to today and fades out, because it has not ended
 *   · has activity   → a closed bar from launch to the last message
 *   · launch only    → a dot on its own lane, because a duration would be invented
 *
 * ── Why a window rather than everything ─────────────────────────────────────────────────────────
 * Eight months at once put January and August on one screen and left every bar a few pixels wide. The
 * window is a month by default and the scale always fills the panel, so the bars are readable at every
 * range instead of only at the widest.
 */
type Range = "1m" | "3m" | "6m" | "1y" | "all";

const RANGES: [Range, string, number][] = [
  ["1m", "1M", 30],
  ["3m", "3M", 91],
  ["6m", "6M", 182],
  ["1y", "1Y", 365],
  ["all", "All", 0],
];

const DAY_MS = 86_400_000;
const utcDay = (time: number) => {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

export default function Timeline({ campaigns }: { campaigns: Campaign[] }) {
  const [range, setRange] = useState<Range>("1m");
  /*
   * "Now", pinned on mount.
   *
   * Reading the clock during render makes the window depend on when React happened to re-render, so a
   * bar could shift under a hover. Fixed at mount, the window only moves on a reload or a range change.
   */
  const [now, setNow] = useState(0);
  useEffect(() => setNow(Date.now()), []);

  const model = useMemo(() => {
    const dated = campaigns
      .filter((row) => row.launchedAt && !Number.isNaN(Date.parse(row.launchedAt)))
      .map((row) => {
        const start = Date.parse(row.launchedAt as string);
        const active = (row.status ?? "").toLowerCase() === "active";
        const last = row.lastActivityAt ? Date.parse(row.lastActivityAt) : NaN;
        const hasActivity = !Number.isNaN(last) && last > start;
        return {
          row,
          start,
          end: active ? now : hasActivity ? last : start,
          active,
          isPoint: !active && !hasActivity,
        };
      });

    if (!dated.length) return null;

    const earliest = Math.min(...dated.map((entry) => entry.start));
    const latest = Math.max(...dated.map((entry) => entry.end), now);
    const days = RANGES.find(([key]) => key === range)?.[2] ?? 30;

    // The window: the last N days up to the newest thing on the chart, or everything.
    const windowEnd = utcDay(latest) + DAY_MS;
    const windowStart = days === 0 ? utcDay(earliest) : Math.max(utcDay(earliest), windowEnd - days * DAY_MS);
    const span = Math.max(1, windowEnd - windowStart);

    // Only campaigns whose run overlaps the window, newest launch first.
    const rows = dated
      .filter((entry) => entry.end >= windowStart && entry.start <= windowEnd)
      .sort((a, b) => b.start - a.start);

    /** Position as a percentage of the window, so the scale always fills the panel. */
    const at = (time: number) => ((Math.min(Math.max(time, windowStart), windowEnd) - windowStart) / span) * 100;

    /*
     * Ticks. A month window is read in weeks and a year in months, so the unit follows the range rather
     * than being fixed — a year of week labels is unreadable, and a month of month labels says nothing.
     */
    const ticks: { label: string; left: number }[] = [];
    if (days !== 0 && days <= 31) {
      for (let time = windowStart; time < windowEnd; time += 7 * DAY_MS) {
        ticks.push({
          label: new Date(time).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
          left: at(time),
        });
      }
    } else {
      const first = new Date(windowStart);
      let cursor = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1);
      if (cursor < windowStart) cursor = Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1);
      while (cursor < windowEnd) {
        const date = new Date(cursor);
        ticks.push({
          label: date.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }),
          left: at(cursor),
        });
        cursor = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
      }
    }

    return {
      rows,
      ticks,
      at,
      today: now >= windowStart && now <= windowEnd ? at(now) : null,
      hidden: dated.length - rows.length,
    };
  }, [campaigns, range, now]);

  const control = (
    <div className="tl-range">
      {RANGES.map(([key, label]) => (
        <button key={key} className={range === key ? "on" : ""} onClick={() => setRange(key)}>
          {label}
        </button>
      ))}
    </div>
  );

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
        <div className="tl-tools">
          <div className="tl-key">
            <span><i className="tl-key-bar" />Ran</span>
            <span><i className="tl-key-live" />Running</span>
            <span><i className="tl-key-dot" />Launch only</span>
          </div>
          {control}
        </div>
      </div>

      {model.rows.length === 0 ? (
        <p className="empty">Nothing ran in this window. Try a longer range.</p>
      ) : (
        <>
          <div className="tl-grid-layout">
            {/* The name column. Fixed, so it never scrolls away from its own row. */}
            <div className="tl-names">
              <div className="tl-names-head" />
              {model.rows.map(({ row }) => (
                <div className="tl-name" key={row.campaignId || row.name} title={row.name}>
                  {row.name || "Untitled campaign"}
                </div>
              ))}
            </div>

            <div className="tl-chart">
              <div className="tl-ruler">
                {model.ticks.map((tick) => (
                  <span key={`${tick.label}-${tick.left}`} className="tl-tick" style={{ left: `${tick.left}%` }}>
                    {tick.label}
                  </span>
                ))}
              </div>

              <div className="tl-lanes">
                {/* Rules and the today line span every lane, behind the bars. */}
                <div className="tl-rules" aria-hidden="true">
                  {model.ticks.map((tick) => (
                    <span key={`rule-${tick.left}`} className="tl-rule" style={{ left: `${tick.left}%` }} />
                  ))}
                  {model.today !== null && <span className="tl-today" style={{ left: `${model.today}%` }} />}
                </div>

                {model.rows.map(({ row, start, end, active, isPoint }) => {
                  const left = model.at(start);
                  const width = Math.max(model.at(end) - left, 0.6);
                  const days = Math.max(1, Math.round((end - start) / DAY_MS));
                  const label = `${row.name} · launched ${new Date(start).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}${
                    isPoint ? " · no activity recorded" : active ? ` · running ${days} days` : ` · ran ${days} days`
                  }`;

                  return (
                    <div className="tl-lane" key={row.campaignId || row.name}>
                      {isPoint ? (
                        <span className="tl-dot" style={{ left: `${left}%` }} title={label} />
                      ) : (
                        <span
                          className={`tl-bar ${active ? "is-live" : ""}`}
                          style={{ left: `${left}%`, width: `${width}%` }}
                          title={label}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {model.hidden > 0 && (
            <p className="tl-hidden">
              {model.hidden} campaign{model.hidden === 1 ? "" : "s"} ran outside this window.
            </p>
          )}
        </>
      )}
    </div>
  );
}
