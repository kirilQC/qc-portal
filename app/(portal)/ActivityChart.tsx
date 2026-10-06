// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The overview's activity chart: two panels on one daily timeline.
 *
 * ── Why two panels ──────────────────────────────────────────────────────────────────────────────
 * A client sends ~50 connection requests a day and gets a handful of replies, so on one shared axis
 * the replies flattened into the floor. Connections sent gets its own short panel on top; replies and
 * positive replies get the taller panel underneath with an axis that fits them. Both share the dates,
 * and hovering either shows the whole day.
 *
 * ── Why the replies are averaged ────────────────────────────────────────────────────────────────
 * Day to day, replies jump 0 → 9 → 0 and the raw line reads as noise. For a month or all time the
 * lines are a 7-day trailing average (computed on the server with the week before the window, so the
 * first days are not part-week averages). The tooltip always shows the real day next to the average.
 * Meetings are pins on the day they were booked: averaging them would print "0.3 meetings".
 *
 * The curve is monotone cubic: smooth like HeyReach's, but it never rises above or dips below a point.
 */

export type ActivityPoint = {
  /** `sent` is null for a day QC Command has not synced from HeyReach yet: unknown, not zero. */
  date: string; sent: number | null; replies: number; positive: number; meetings: number;
  repliesAvg: number; positiveAvg: number;
};

const COLORS = { sent: "#f59e0b", replies: "#5b8cff", positive: "#2fbf7f", meetings: "#c05bd9" } as const;
const ML = 38, MR = 14;
// Heights are real pixels: the chart is drawn at its on-screen width (see `width` below), so text and
// strokes keep their size instead of growing with the viewBox on a wide screen.
const TOP = { h: 120, mt: 10, mb: 8 };
const BOTTOM = { h: 240, mt: 24, mb: 30 };

/** Whole-number ticks with a 1/2/5 × 10ⁿ step and at most five gaps, so the axis never reads "3, 5, 8". */
function ticks(max: number): number[] {
  const target = Math.max(1, max);
  for (const base of [1, 10, 100, 1000, 10000]) {
    for (const mult of [1, 2, 2.5, 5]) {
      const step = base * mult;
      if (!Number.isInteger(step)) continue;
      const count = Math.ceil(target / step);
      if (count <= 5) return Array.from({ length: count + 1 }, (_, i) => i * step);
    }
  }
  return [0, target];
}

/** Monotone cubic (Fritsch–Carlson) as a bezier path: smooth, but never overshoots a point. */
function monotonePath(points: [number, number][]): string {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M${points[0][0]},${points[0][1]}`;
  const dx: number[] = [], slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1][0] - points[i][0]);
    slope.push((points[i + 1][1] - points[i][1]) / dx[i]);
  }
  const tangent: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) tangent.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  tangent.push(slope[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { tangent[i] = 0; tangent[i + 1] = 0; continue; }
    const a = tangent[i] / slope[i], b = tangent[i + 1] / slope[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); tangent[i] = t * a * slope[i]; tangent[i + 1] = t * b * slope[i]; }
  }
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i], [x1, y1] = points[i + 1], third = dx[i] / 3;
    d += ` C${x0 + third},${y0 + tangent[i] * third} ${x1 - third},${y1 - tangent[i + 1] * third} ${x1},${y1}`;
  }
  return d;
}

const fmt = (iso: string, options: Intl.DateTimeFormatOptions) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...options });
const one = (v: number) => (Math.round(v * 10) / 10).toLocaleString("en-US");

export default function ActivityChart({ points, smoothed }: { points: ActivityPoint[]; smoothed: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  // Drawn at the container's real width, so a 10px label is 10px on every screen. (It used to be a fixed
  // 1000-unit viewBox scaled to fit, which blew the axis text up to ~20px on a wide monitor.)
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  const hasPoints = points.length > 0;
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(320, Math.round(el.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasPoints]); // re-measure once there is a chart to measure
  const W = width, IW = W - ML - MR;

  if (!points.length) return <p className="trend-empty">No activity to chart yet.</p>;

  const last = points.length - 1;
  // The line ends on today while the day is still running: that point gets a live pulse.
  const endsToday = points[last]?.date === new Date().toISOString().slice(0, 10);
  const x = (i: number) => (points.length === 1 ? ML + IW / 2 : ML + (i / last) * IW);

  // Top panel: connections sent.
  const sentTicks = ticks(Math.max(0, ...points.map((p) => p.sent ?? 0)));
  const sentTop = sentTicks[sentTicks.length - 1];
  const topBase = TOP.h - TOP.mb;
  const yTop = (v: number) => TOP.mt + (1 - v / sentTop) * (topBase - TOP.mt);
  // Only the synced days: the line ends where the data ends rather than dropping to a false zero.
  const syncedIdx = points.map((p, i) => (p.sent == null ? -1 : i)).filter((i) => i >= 0);
  const sentLine = monotonePath(syncedIdx.map((i) => [x(i), yTop(points[i].sent ?? 0)]));
  const sentLast = syncedIdx.length ? syncedIdx[syncedIdx.length - 1] : 0;
  const sentFirst = syncedIdx.length ? syncedIdx[0] : 0;

  // Bottom panel: replies and positive replies (averaged for a month or all time), meetings as pins.
  const replyKey = smoothed ? "repliesAvg" : "replies";
  const positiveKey = smoothed ? "positiveAvg" : "positive";
  const replyTicks = ticks(Math.max(...points.map((p) => Math.max(p[replyKey], p[positiveKey]))));
  const replyTop = replyTicks[replyTicks.length - 1];
  const bottomBase = BOTTOM.h - BOTTOM.mb;
  const yBottom = (v: number) => BOTTOM.mt + (1 - v / replyTop) * (bottomBase - BOTTOM.mt);
  const repliesLine = monotonePath(points.map((p, i) => [x(i), yBottom(p[replyKey])]));
  const positiveLine = monotonePath(points.map((p, i) => [x(i), yBottom(p[positiveKey])]));
  const area = (line: string, base: number) => `${line} L${x(last)},${base} L${x(0)},${base} Z`;

  // Dates along the bottom: weekday names for a week, short dates otherwise, never colliding.
  const weekView = points.length <= 7;
  const every = weekView ? 1 : Math.max(1, Math.ceil(points.length / 7));
  const showLabel = (i: number) => i === last || (i % every === 0 && last - i >= every * 0.6);
  const label = (iso: string) => (weekView ? fmt(iso, { weekday: "long" }) : fmt(iso, { month: "short", day: "numeric" }));

  // Measured from the panel the pointer is on, so either panel drives the same hover.
  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const sx = ((event.clientX - box.left) / box.width) * W;
    setHover(Math.max(0, Math.min(last, Math.round(((sx - ML) / IW) * last))));
  };

  const tipLeft = hover === null ? 0 : (x(hover) / W) * 100;
  const point = hover === null ? null : points[hover];

  return (
    <div className="act-wrap" ref={wrapRef} onPointerLeave={() => setHover(null)}>
      <div className="act-panel-label">Connections sent</div>
      <svg viewBox={`0 0 ${W} ${TOP.h}`} className="act-svg" onPointerMove={onMove} onPointerDown={onMove} role="img"
        aria-label={`Connections sent: ${points.reduce((t, p) => t + (p.sent ?? 0), 0)} over ${syncedIdx.length} synced days`}>
        <defs>
          <linearGradient id="act-sent" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLORS.sent} stopOpacity="0.22" />
            <stop offset="100%" stopColor={COLORS.sent} stopOpacity="0" />
          </linearGradient>
        </defs>
        {sentTicks.map((t) => (
          <g key={t}>
            <text x={ML - 10} y={yTop(t) + 4} textAnchor="end" className="act-axis">{t.toLocaleString("en-US")}</text>
          </g>
        ))}
        {syncedIdx.length > 0 && <path d={`${sentLine} L${x(sentLast)},${topBase} L${x(sentFirst)},${topBase} Z`} className="act-fade" fill="url(#act-sent)" />}
        <path d={sentLine} pathLength={1} className="act-draw" fill="none" stroke={COLORS.sent} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        {point && <>
          <line x1={x(hover!)} x2={x(hover!)} y1={TOP.mt} y2={topBase} className="act-guide" />
          {point.sent != null && <circle cx={x(hover!)} cy={yTop(point.sent)} r={4.5} fill={COLORS.sent} stroke="var(--panel, #111319)" strokeWidth={2} />}
        </>}
      </svg>

      <div className="act-panel-label act-panel-gap">Replies and meetings{smoothed ? " · 7-day average" : ""}</div>
      <svg viewBox={`0 0 ${W} ${BOTTOM.h}`} className="act-svg" onPointerMove={onMove} onPointerDown={onMove} role="img"
        aria-label={`Replies: ${points.reduce((t, p) => t + p.replies, 0)}, positive replies: ${points.reduce((t, p) => t + p.positive, 0)}, meetings booked: ${points.reduce((t, p) => t + p.meetings, 0)}`}>
        <defs>
          {(["replies", "positive"] as const).map((key) => (
            <linearGradient key={key} id={`act-${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS[key]} stopOpacity="0.16" />
              <stop offset="100%" stopColor={COLORS[key]} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {replyTicks.map((t) => (
          <g key={t}>
            <text x={ML - 10} y={yBottom(t) + 4} textAnchor="end" className="act-axis">{t.toLocaleString("en-US")}</text>
          </g>
        ))}
        {points.map((p, i) => showLabel(i) ? (
          <text key={p.date} x={x(i)} y={BOTTOM.h - 12} textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"} className="act-axis act-x">{label(p.date)}</text>
        ) : null)}
        <path d={area(repliesLine, bottomBase)} className="act-fade" fill="url(#act-replies)" />
        <path d={area(positiveLine, bottomBase)} className="act-fade" fill="url(#act-positive)" />
        <path d={repliesLine} pathLength={1} className="act-draw act-draw-2" fill="none" stroke={COLORS.replies} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        <path d={positiveLine} pathLength={1} className="act-draw act-draw-3" fill="none" stroke={COLORS.positive} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => p.meetings ? (
          <g key={`m-${p.date}`} className="act-pin act-pin-drop" style={{ animationDelay: `${0.9 + (i / Math.max(1, last)) * 0.5}s` }}>
            <line x1={x(i)} x2={x(i)} y1={BOTTOM.mt - 2} y2={bottomBase} stroke={COLORS.meetings} strokeDasharray="2 3" opacity={0.55} />
            <circle cx={x(i)} cy={BOTTOM.mt - 9} r={7.5} fill="var(--panel, #111319)" stroke={COLORS.meetings} strokeWidth={2} />
            <text x={x(i)} y={BOTTOM.mt - 5.5} textAnchor="middle" className="act-pin-n" fill={COLORS.meetings}>{p.meetings}</text>
          </g>
        ) : null)}
        {endsToday && (
          <g className="act-now" aria-hidden="true">
            <circle cx={x(last)} cy={yBottom(points[last][replyKey])} r={4} className="act-now-ring" stroke={COLORS.replies} />
            <circle cx={x(last)} cy={yBottom(points[last][replyKey])} r={3.5} fill={COLORS.replies} />
          </g>
        )}
        {point && <>
          <line x1={x(hover!)} x2={x(hover!)} y1={BOTTOM.mt} y2={bottomBase} className="act-guide" />
          <circle cx={x(hover!)} cy={yBottom(point[replyKey])} r={4.5} fill={COLORS.replies} stroke="var(--panel, #111319)" strokeWidth={2} />
          <circle cx={x(hover!)} cy={yBottom(point[positiveKey])} r={4.5} fill={COLORS.positive} stroke="var(--panel, #111319)" strokeWidth={2} />
        </>}
      </svg>

      {point && (
        <div className={`act-tip ${tipLeft > 58 ? "is-left" : ""}`} style={{ left: `${tipLeft}%` }}>
          <b>{fmt(point.date, { month: "short", day: "numeric", year: "numeric" })}{hover === last ? " (today, so far)" : ""}</b>
          <div className="act-tip-row"><i style={{ background: COLORS.sent }} /><span>Connections sent</span>{point.sent == null ? <em>not synced yet</em> : <data value={point.sent}>{point.sent}</data>}</div>
          <div className="act-tip-row"><i style={{ background: COLORS.replies }} /><span>Replies</span>{smoothed && <em>avg {one(point.repliesAvg)}</em>}<data value={point.replies}>{point.replies}</data></div>
          <div className="act-tip-row"><i style={{ background: COLORS.positive }} /><span>Positive replies</span>{smoothed && <em>avg {one(point.positiveAvg)}</em>}<data value={point.positive}>{point.positive}</data></div>
          <div className="act-tip-row"><i style={{ background: COLORS.meetings }} /><span>Booked meetings</span><data value={point.meetings}>{point.meetings}</data></div>
        </div>
      )}

      <div className="act-legend">
        <span><i style={{ background: COLORS.sent }} />Connections sent</span>
        <span><i style={{ background: COLORS.replies }} />Replies</span>
        <span><i style={{ background: COLORS.positive }} />Positive replies</span>
        <span><i className="act-legend-pin" style={{ borderColor: COLORS.meetings }} />Booked meeting</span>
      </div>
    </div>
  );
}
