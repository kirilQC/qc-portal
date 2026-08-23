// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";
/* eslint-disable react-hooks/set-state-in-effect -- the clock and the panel width are read on mount;
   reading either during render would make the scale depend on when React happened to re-render. */

import { useEffect, useMemo, useRef, useState } from "react";
import type { Campaign } from "../../components/usePortal";

/**
 * When each campaign ran, on one scrollable scale.
 *
 * ── The range is a zoom, not a filter ───────────────────────────────────────────────────────────
 * Every campaign is always on the chart. What the control changes is how much time one screen covers:
 * "1M" means a month fills the viewport, so the detail is month-by-month and January is still there,
 * several screens to the left. That is the difference between a magnification and a date filter, and
 * the first version had it wrong — it dropped everything outside a window, which is why twenty-four
 * campaigns disappeared at the default setting.
 *
 * ── Where the end of a run comes from ───────────────────────────────────────────────────────────
 * HeyReach records when a campaign launched and never when it stopped, so an end has to be inferred:
 * the newest message attributable to a campaign is the last evidence it did anything. A campaign still
 * marked active runs to today, and its bar fades out rather than drawing an end it does not have.
 *
 * ── The runtime figure on each bar ──────────────────────────────────────────────────────────────
 * Reply Radar's arithmetic: a sender sends twenty-five connection requests a day, so a campaign's
 * planned length is its lead count divided by senders times twenty-five. Both numbers are on the bar
 * because "ran six weeks" and "was always going to take six weeks" are different facts, and the gap
 * between them is how a stalled campaign shows itself.
 */
type Zoom = "1m" | "3m" | "6m" | "1y";

/** key, label, days that fill one screen at that zoom. */
const ZOOMS: [Zoom, string, number][] = [
  ["1m", "1M", 30],
  ["3m", "3M", 91],
  ["6m", "6M", 182],
  ["1y", "1Y", 365],
];

const DAY_MS = 86_400_000;
/** Reply Radar's constant: one sender sends twenty-five connection requests a day. */
const PER_SENDER_PER_DAY = 25;

const utcDay = (time: number) => {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

/** The days a campaign needs to work its whole list, at twenty-five requests per sender per day. */
function plannedDays(row: Campaign): number | null {
  const senders = row.senders.length;
  const leads = Math.max(row.totalLeads, row.connectionsSent);
  if (!senders || !leads) return null;
  return Math.max(1, Math.ceil(leads / (senders * PER_SENDER_PER_DAY)));
}

export default function Timeline({ campaigns }: { campaigns: Campaign[] }) {
  const [zoom, setZoom] = useState<Zoom>("1m");
  const [now, setNow] = useState(0);
  const [viewport, setViewport] = useState(0);
  const scroller = useRef<HTMLDivElement | null>(null);
  const anchored = useRef("");

  useEffect(() => setNow(Date.now()), []);

  /*
   * Pixels-per-day is derived from the panel's actual width, so a zoom level means the same span of
   * time on a laptop as on a wide monitor rather than a different one on each.
   */
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const measure = () => setViewport(box.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const model = useMemo(() => {
    if (!now || !viewport) return null;

    const dated = campaigns
      .filter((row) => row.launchedAt && !Number.isNaN(Date.parse(row.launchedAt)))
      .map((row) => {
        const start = Date.parse(row.launchedAt as string);
        const active = (row.status ?? "").toLowerCase() === "active";
        const last = row.lastActivityAt ? Date.parse(row.lastActivityAt) : NaN;
        const hasActivity = !Number.isNaN(last) && last > start;
        return { row, start, end: active ? now : hasActivity ? last : start, active, isPoint: !active && !hasActivity };
      })
      // Oldest first, so the row order is stable while scrolling forward through time.
      .sort((a, b) => a.start - b.start);

    if (!dated.length) return null;

    // The whole history, always. The zoom sets the density; it never decides what is included.
    const first = new Date(Math.min(...dated.map((entry) => entry.start)));
    const scaleStart = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1);
    const scaleEnd = utcDay(Math.max(...dated.map((entry) => entry.end), now)) + 10 * DAY_MS;

    const days = ZOOMS.find(([key]) => key === zoom)?.[2] ?? 30;
    const perDay = viewport / days;
    const at = (time: number) => ((time - scaleStart) / DAY_MS) * perDay;

    // Month ticks always; day ticks inside them only when there is room to read them.
    const ticks: { label: string; left: number; month: boolean }[] = [];
    for (let cursor = scaleStart; cursor < scaleEnd; ) {
      const date = new Date(cursor);
      ticks.push({
        label: date.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }),
        left: at(cursor),
        month: true,
      });
      const nextMonth = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
      if (perDay > 11) {
        for (let week = cursor + 7 * DAY_MS; week < nextMonth; week += 7 * DAY_MS) {
          ticks.push({ label: String(new Date(week).getUTCDate()), left: at(week), month: false });
        }
      }
      cursor = nextMonth;
    }

    return { rows: dated, ticks, at, width: at(scaleEnd), today: at(now) };
  }, [campaigns, zoom, now, viewport]);

  /*
   * Open on today, and re-anchor whenever the zoom changes.
   *
   * Keeping the pixel offset across a zoom change lands somewhere arbitrary, because the same offset is
   * a different date at every magnification. Today is the one anchor that always means something.
   */
  useEffect(() => {
    const box = scroller.current;
    if (!box || !model) return;
    const key = `${zoom}:${Math.round(model.width)}`;
    if (anchored.current === key) return;
    anchored.current = key;
    box.scrollLeft = Math.max(0, model.today - box.clientWidth * 0.75);
  }, [model, zoom]);

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
          <div className="tl-range">
            {ZOOMS.map(([key, label]) => (
              <button
                key={key}
                className={zoom === key ? "on" : ""}
                onClick={() => setZoom(key)}
                title={`${label} across the screen`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Always rendered, so it can be measured before there is anything to draw inside it. */}
      <div className="tl-scroll" ref={scroller}>
        {!model ? (
          <p className="loading">Drawing the timeline…</p>
        ) : (
          <div className="tl-canvas" style={{ width: model.width }}>
            <div className="tl-ruler">
              {model.ticks.map((tick) => (
                <span
                  key={`${tick.label}-${Math.round(tick.left)}`}
                  className={`tl-tick ${tick.month ? "is-month" : "is-day"}`}
                  style={{ left: tick.left }}
                >
                  {tick.label}
                </span>
              ))}
            </div>

            <div className="tl-lanes">
              <div className="tl-rules" aria-hidden="true">
                {model.ticks.map((tick) => (
                  <span
                    key={`rule-${Math.round(tick.left)}`}
                    className={`tl-rule ${tick.month ? "is-month" : ""}`}
                    style={{ left: tick.left }}
                  />
                ))}
                <span className="tl-today" style={{ left: model.today }} />
              </div>

              {model.rows.map(({ row, start, end, active, isPoint }) => {
                const left = model.at(start);
                const width = Math.max(model.at(end) - left, 10);
                const ran = Math.max(1, Math.round((end - start) / DAY_MS));
                const planned = plannedDays(row);
                const senders = row.senders.length;
                const title = `${row.name} · launched ${new Date(start).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}${
                  isPoint ? " · no activity recorded" : active ? ` · running, ${ran} days so far` : ` · ran ${ran} days`
                }${planned ? ` · ${planned} days planned at ${senders} sender${senders === 1 ? "" : "s"} × 25/day` : ""}`;

                return (
                  <div className="tl-lane" key={row.campaignId || row.name}>
                    {isPoint ? (
                      <>
                        <span className="tl-dot" style={{ left }} title={title} />
                        <span className="tl-dot-label" style={{ left: left + 14 }}>
                          {row.name}
                          {planned ? <em>{planned}d planned</em> : null}
                        </span>
                      </>
                    ) : (
                      <span className={`tl-bar ${active ? "is-live" : ""}`} style={{ left, width }} title={title}>
                        <span className="tl-bar-name">{row.name}</span>
                        <span className="tl-bar-run">
                          {ran}d{planned ? ` / ${planned}d` : ""}
                        </span>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
