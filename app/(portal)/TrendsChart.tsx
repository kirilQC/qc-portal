// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// Reply Radar / QC Portal — proprietary.

"use client";

import { useRef, useState } from "react";

export type TrendPoint = { week: string; total: number; positive: number; meetings: number; sent: number };
type MetricKey = "total" | "positive" | "meetings" | "sent";
// Connections sent first, so its (large) area and line are drawn behind the reply lines that ride on top.
const SERIES: { key: MetricKey; label: string; color: string }[] = [
  { key: "sent", label: "Connections sent", color: "#f2c94c" },
  { key: "total", label: "Total replies", color: "#5b8cff" },
  { key: "positive", label: "Positive replies", color: "#46d39a" },
  { key: "meetings", label: "Booked meetings", color: "#a78bfa" },
];

const W = 960, H = 300, ml = 42, mr = 46, mt = 18, mb = 44;
const iw = W - ml - mr, ih = H - mt - mb;

/** Catmull-Rom → cubic-bezier, so the line reads as a trend rather than a zig-zag. */
function smooth(pts: [number, number][]): string {
  if (pts.length < 2) return pts.length ? `M ${pts[0][0]} ${pts[0][1]}` : "";
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`;
  }
  return d;
}
const fmt = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); return Number.isNaN(+d) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); };

export default function TrendsChart({ data }: { data: TrendPoint[] }) {
  const [hi, setHi] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  if (!data || data.length < 2) return <p className="trend-empty">Not enough history yet to chart a trend.</p>;

  // Two axes: replies (tens) on the LEFT, connections sent (hundreds) on the RIGHT — otherwise the big
  // sent line flattens every reply line into the floor. Each series is drawn against its own scale.
  const replyPeak = Math.max(6, ...data.map((d) => Math.max(d.total, d.positive, d.meetings)));
  const sentPeak = Math.max(10, ...data.map((d) => d.sent));
  const leftMax = Math.ceil(replyPeak / 10) * 10;
  const rightMax = Math.ceil(sentPeak / 100) * 100;
  const X = (i: number) => ml + (i / (data.length - 1)) * iw;
  const YL = (v: number) => mt + (1 - v / leftMax) * ih;
  const YR = (v: number) => mt + (1 - v / rightMax) * ih;
  const yOf = (k: MetricKey) => (k === "sent" ? YR : YL);
  const baseY = mt + ih;
  const pts = (k: MetricKey) => data.map((d, i) => [X(i), yOf(k)(d[k])] as [number, number]);
  const areaPath = (k: MetricKey) => `${smooth(pts(k))} L ${X(data.length - 1)} ${baseY} L ${X(0)} ${baseY} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  // Every other week label when the series is dense, so they never collide.
  const labelEvery = data.length > 9 ? 2 : 1;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = ref.current?.getBoundingClientRect(); if (!r) return;
    const sx = ((e.clientX - r.left) / r.width) * W;
    let i = Math.round(((sx - ml) / iw) * (data.length - 1));
    i = Math.max(0, Math.min(data.length - 1, i));
    setHi(i);
  };

  return (
    <div className="trend-wrap" onPointerLeave={() => setHi(null)}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="trend-svg" onPointerMove={onMove} role="img" aria-label="Weekly reply trends">
        <defs>
          {SERIES.map((s) => (
            <linearGradient key={s.key} id={`tg-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.34" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t, k) => { const y = mt + (1 - t) * ih; return (
          <g key={k}>
            <line x1={ml} y1={y} x2={W - mr} y2={y} stroke="rgba(255,255,255,.05)" strokeDasharray="3 5" />
            <text x={ml - 10} y={y + 4} textAnchor="end" className="trend-axis">{Math.round(t * leftMax)}</text>
            <text x={W - mr + 8} y={y + 4} textAnchor="start" className="trend-axis-right">{Math.round(t * rightMax)}</text>
          </g>
        ); })}
        {data.map((d, i) => (i % labelEvery === 0 ? <text key={i} x={X(i)} y={H - 15} textAnchor="middle" className="trend-xlab">{fmt(d.week)}</text> : null))}
        {SERIES.map((s) => <path key={`a-${s.key}`} d={areaPath(s.key)} fill={`url(#tg-${s.key})`} />)}
        {SERIES.map((s) => <path key={`l-${s.key}`} d={smooth(pts(s.key))} fill="none" stroke={s.color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />)}
        {hi !== null && <line x1={X(hi)} y1={mt} x2={X(hi)} y2={mt + ih} stroke="rgba(255,255,255,.22)" />}
        {hi !== null && SERIES.map((s) => <circle key={s.key} cx={X(hi)} cy={yOf(s.key)(data[hi][s.key])} r={4.5} fill="#0a0b0f" stroke={s.color} strokeWidth={2} />)}
      </svg>
      {hi !== null && (
        <div className="trend-tip" style={{ left: `${(X(hi) / W) * 100}%` }}>
          <b>Week of {fmt(data[hi].week)}</b>
          {SERIES.map((s) => (
            <div className="trend-tip-r" key={s.key}><i style={{ background: s.color }} />{s.label}<data>{data[hi][s.key]}</data></div>
          ))}
        </div>
      )}
      <div className="trend-legend">
        {SERIES.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
      </div>
    </div>
  );
}
