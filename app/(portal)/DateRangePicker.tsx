// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The overview's custom range: a button that opens a two-month calendar.
 *
 * Click a first day, then a last day (hovering previews the span); Apply sends both as YYYY-MM-DD.
 * Days after today are disabled — there is nothing to show for them — and a range runs up to two years.
 * Dates are calendar days, not instants, so they are built in UTC from the start and never shift a day
 * for a viewer west of Greenwich.
 */

export type DayRange = { from: string; to: string };

const DAY_MS = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ms = (day: string) => Date.parse(`${day}T00:00:00Z`);
/** Today as the server counts it (UTC), so the last pickable day is never one the server refuses. */
const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStart = (year: number, month: number) => Date.UTC(year, month, 1);
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export function rangeLabel(range: DayRange): string {
  const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);
  const fmt = (day: string, year: boolean) => new Date(ms(day)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}) });
  return range.from === range.to ? fmt(range.from, true) : `${fmt(range.from, !sameYear)} – ${fmt(range.to, true)}`;
}

function Month({ year, month, start, end, hover, today, onPick, onHover }: {
  year: number; month: number; start: string | null; end: string | null; hover: string | null; today: string;
  onPick: (day: string) => void; onHover: (day: string | null) => void;
}) {
  const first = monthStart(year, month);
  const lead = (new Date(first).getUTCDay() + 6) % 7; // Monday-first grid
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  // The span on screen: the chosen one, or — while only a start is set — start to wherever the pointer is.
  const lo = start && (end ?? hover) ? (start < (end ?? hover)! ? start : (end ?? hover)!) : start;
  const hi = start && (end ?? hover) ? (start < (end ?? hover)! ? (end ?? hover)! : start) : start;
  return (
    <div className="drp-month">
      <div className="drp-month-name">{new Date(first).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" })}</div>
      <div className="drp-grid" role="grid">
        {WEEKDAYS.map((d) => <span key={d} className="drp-dow">{d}</span>)}
        {Array.from({ length: lead }).map((_, i) => <span key={`b${i}`} />)}
        {Array.from({ length: days }).map((_, i) => {
          const day = iso(first + i * DAY_MS);
          const future = day > today;
          const inSpan = lo && hi ? day >= lo && day <= hi : false;
          const edge = day === lo || day === hi;
          return (
            <button
              key={day}
              type="button"
              disabled={future}
              className={`drp-day ${inSpan ? "in" : ""} ${edge ? "edge" : ""} ${day === today ? "today" : ""}`}
              aria-pressed={edge}
              aria-label={new Date(ms(day)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" })}
              onClick={() => onPick(day)}
              onMouseEnter={() => onHover(day)}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function DateRangePicker({ value, active, onApply }: { value: DayRange | null; active: boolean; onApply: (range: DayRange) => void }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<string | null>(value?.from ?? null);
  const [end, setEnd] = useState<string | null>(value?.to ?? null);
  const [hover, setHover] = useState<string | null>(null);
  const today = todayIso();
  // The right-hand month: the chosen end's month, else this month. The left one is the month before it.
  const anchor = new Date(ms(value?.to ?? today));
  const [view, setView] = useState({ year: anchor.getUTCFullYear(), month: anchor.getUTCMonth() });
  const box = useRef<HTMLDivElement>(null);

  // Close on Escape or a click outside the popover.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const onDown = (event: PointerEvent) => { if (box.current && !box.current.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onDown); };
  }, [open]);

  const toggle = () => {
    if (!open) { setStart(value?.from ?? null); setEnd(value?.to ?? null); setHover(null); }
    setOpen((was) => !was);
  };
  const pick = (day: string) => {
    if (!start || end) { setStart(day); setEnd(null); return; }
    if (day < start) { setEnd(start); setStart(day); } else setEnd(day);
  };
  const shift = (by: number) => setView((v) => { const d = new Date(Date.UTC(v.year, v.month + by, 1)); return { year: d.getUTCFullYear(), month: d.getUTCMonth() }; });
  const left = new Date(Date.UTC(view.year, view.month - 1, 1));
  const tooLong = start && end ? ms(end) - ms(start) > 731 * DAY_MS : false;
  const atLatest = view.year > new Date(ms(today)).getUTCFullYear() || (view.year === new Date(ms(today)).getUTCFullYear() && view.month >= new Date(ms(today)).getUTCMonth());
  const apply = () => { if (!start) return; onApply({ from: start, to: end ?? start }); setOpen(false); };
  const preset = (days: number) => { const to = today; const from = iso(ms(today) - (days - 1) * DAY_MS); setStart(from); setEnd(to); };

  return (
    <div className="drp" ref={box}>
      <button type="button" className={`ov-range ${active ? "is-on" : ""}`} aria-expanded={open} aria-haspopup="dialog" onClick={toggle}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16v14H4zM4 10h16M9 3v4M15 3v4" /></svg>
        {active && value ? rangeLabel(value) : "Custom"}
      </button>
      {open && (
        <div className="drp-pop" role="dialog" aria-label="Choose a date range">
          <div className="drp-presets">
            {[[14, "Last 14 days"], [60, "Last 60 days"], [90, "Last 90 days"]].map(([days, label]) => (
              <button key={label} type="button" onClick={() => preset(days as number)}>{label}</button>
            ))}
          </div>
          <div className="drp-cal" onMouseLeave={() => setHover(null)}>
            <button type="button" className="drp-nav prev" aria-label="Previous month" onClick={() => shift(-1)}>‹</button>
            <button type="button" className="drp-nav next" aria-label="Next month" disabled={atLatest} onClick={() => shift(1)}>›</button>
            <div className="drp-months">
              <Month year={left.getUTCFullYear()} month={left.getUTCMonth()} start={start} end={end} hover={hover} today={today} onPick={pick} onHover={setHover} />
              <Month year={view.year} month={view.month} start={start} end={end} hover={hover} today={today} onPick={pick} onHover={setHover} />
            </div>
          </div>
          <div className="drp-foot">
            <span className="drp-summary">
              {tooLong ? "Pick a range of two years or less." : start ? rangeLabel({ from: start, to: end ?? start }) + (end ? "" : " · pick an end day") : "Pick a start day"}
            </span>
            <button type="button" className="drp-cancel" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="drp-apply" disabled={!start || tooLong} onClick={apply}>Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}
