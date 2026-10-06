// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { useRef, useState } from "react";

/**
 * The overview's activity chart, rebuilt on HeyReach's own dashboard graph: one shared axis, smooth lines
 * with a soft fill, a dashed guide on hover and a card listing every figure for that point.
 *
 * ── What it fixes in the chart it replaces ──────────────────────────────────────────────────────
 * The old chart counted reply *messages* (a week read 40 when 30 people replied), ended on the current
 * half-finished week drawn as a collapse, put two y-axes on one plot so a 25 sat beside the "200"
 * gridline, and used a Catmull-Rom curve that bulged past the real points. Points here are days (or
 * weeks for all time) with replies counted as people, there is one axis, and the curve is monotone:
 * it never rises above or dips below the values it passes through.
 */

export type ActivityPoint = { date: string; sent: number; replies: number; positive: number; meetings: number };
type Key = "sent" | "replies" | "positive" | "meetings";

const SERIES: { key: Key; label: string; color: string; fill: number }[] = [
  { key: "sent", label: "Connections sent", color: "#f59e0b", fill: 0.22 },
  { key: "replies", label: "Replies", color: "#5b8cff", fill: 0.1 },
  { key: "positive", label: "Positive replies", color: "#2fbf7f", fill: 0.1 },
  { key: "meetings", label: "Booked meetings", color: "#c05bd9", fill: 0.08 },
];

const W = 1000, H = 290, ML = 44, MR = 18, MT = 14, MB = 40;
const IW = W - ML - MR, IH = H - MT - MB;

/** A tidy axis maximum: the next 1/2/2.5/5 × 10ⁿ at or above the data, so the gridlines read cleanly. */
function niceMax(value: number): number {
  if (value <= 4) return 4;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * exp >= value) return step * exp;
  return 10 * exp;
}

/**
 * Monotone cubic interpolation (Fritsch–Carlson), as a bezier path. Smooth like HeyReach's lines, but a
 * flat stretch stays flat and a curve never overshoots a point — no invented peaks, no dips below zero.
 */
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

const asDate = (iso: string) => new Date(`${iso}T12:00:00Z`);
const fmt = (iso: string, options: Intl.DateTimeFormatOptions) => asDate(iso).toLocaleDateString("en-US", { timeZone: "UTC", ...options });

export default function ActivityChart({ points, granularity }: { points: ActivityPoint[]; granularity: "day" | "week" }) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (!points.length) return <p className="trend-empty">No activity to chart yet.</p>;

  const max = niceMax(Math.max(1, ...points.flatMap((p) => SERIES.map((s) => p[s.key]))));
  const x = (i: number) => (points.length === 1 ? ML + IW / 2 : ML + (i / (points.length - 1)) * IW);
  const y = (v: number) => MT + (1 - v / max) * IH;
  const base = MT + IH;
  const line = (key: Key) => monotonePath(points.map((p, i) => [x(i), y(p[key])]));
  const area = (key: Key) => `${line(key)} L${x(points.length - 1)},${base} L${x(0)},${base} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);

  // Weekday names for a week of days, short dates otherwise, thinned so labels never collide.
  const label = (iso: string) => (granularity === "day" && points.length <= 7 ? fmt(iso, { weekday: "long" }) : fmt(iso, { month: "short", day: "numeric" }));
  const every = Math.max(1, Math.ceil(points.length / (granularity === "day" && points.length <= 7 ? 7 : 8)));
  const last = points.length - 1;
  const title = (i: number) => {
    const iso = points[i].date;
    if (granularity === "week") return `Week of ${fmt(iso, { month: "short", day: "numeric", year: "numeric" })}${i === last ? " (so far)" : ""}`;
    return `${fmt(iso, { month: "short", day: "numeric", year: "numeric" })}${i === last ? " (today, so far)" : ""}`;
  };

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    const sx = ((event.clientX - box.left) / box.width) * W;
    const i = Math.round(((sx - ML) / IW) * (points.length - 1));
    setHover(Math.max(0, Math.min(last, i)));
  };

  const tipLeft = hover === null ? 0 : (x(hover) / W) * 100;
  return (
    <div className="act-wrap" onPointerLeave={() => setHover(null)}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="act-svg" onPointerMove={onMove} onPointerDown={onMove} role="img"
        aria-label={`Activity: ${SERIES.map((s) => `${s.label} ${points.reduce((t, p) => t + p[s.key], 0)}`).join(", ")}`}>
        <defs>
          {SERIES.map((s) => (
            <linearGradient key={s.key} id={`act-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={s.fill} />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={ML} x2={W - MR} y1={y(t)} y2={y(t)} className="act-grid" />
            <text x={ML - 12} y={y(t) + 4} textAnchor="end" className="act-axis">{Math.round(t).toLocaleString("en-US")}</text>
          </g>
        ))}
        {points.map((p, i) => (i % every === 0 || i === last) && (last - i >= every / 2 || i === last) ? (
          <text key={p.date} x={x(i)} y={H - 12} textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"} className="act-axis act-x">{label(p.date)}</text>
        ) : null)}
        {SERIES.map((s) => <path key={`a-${s.key}`} d={area(s.key)} fill={`url(#act-${s.key})`} />)}
        {SERIES.map((s) => <path key={`l-${s.key}`} d={line(s.key)} fill="none" stroke={s.color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />)}
        {hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={MT} y2={base} className="act-guide" />
            {SERIES.map((s) => <circle key={s.key} cx={x(hover)} cy={y(points[hover][s.key])} r={4.5} fill={s.color} stroke="var(--panel, #111319)" strokeWidth={2} />)}
          </>
        )}
      </svg>
      {hover !== null && (
        <div className={`act-tip ${tipLeft > 60 ? "is-left" : ""}`} style={{ left: `${tipLeft}%` }}>
          <b>{title(hover)}</b>
          {SERIES.map((s) => (
            <div className="act-tip-row" key={s.key}>
              <i style={{ background: s.color }} />
              <span>{s.label}</span>
              <data value={points[hover][s.key]}>{points[hover][s.key].toLocaleString("en-US")}</data>
            </div>
          ))}
        </div>
      )}
      <div className="act-legend">
        {SERIES.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
      </div>
    </div>
  );
}
