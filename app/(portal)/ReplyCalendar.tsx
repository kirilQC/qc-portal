// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { useState } from "react";

/**
 * The reply calendar: this month, one square per day, shaded by how many people replied.
 *
 * It answers the question the line chart cannot at a glance: "have we heard from someone every day?"
 * The squares light up row by row on load, today pulses, and a small dot marks a day a meeting was
 * booked. Replies / Positive / Meetings switch what the shading measures. Hovering, focusing or tapping
 * a day shows its numbers in the card beside the grid; with nothing chosen the card shows today.
 *
 * Counts come from the server exactly as the activity chart counts them (a person once per day), so the
 * same day agrees on both. Days still to come are drawn as empty dashed slots, never as zeros.
 */

export type CalendarDay = { date: string; replies: number; positive: number; meetings: number; future: boolean };
export type CalendarData = { month: string; today: string; days: CalendarDay[]; streak: number };

type Metric = "replies" | "positive" | "meetings";
const METRICS: [Metric, string][] = [["replies", "Replies"], ["positive", "Positive"], ["meetings", "Meetings"]];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const fmt = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...options });

/** Shade 0–4: none, a little, some, a lot, the most. Meetings are binary — a day had one or it did not. */
function level(value: number, metric: Metric, max: number): number {
  if (value <= 0) return 0;
  if (metric === "meetings") return 4;
  const share = value / Math.max(max, 1);
  return share > 0.75 ? 4 : share > 0.5 ? 3 : share > 0.25 ? 2 : 1;
}

export default function ReplyCalendar({ data }: { data: CalendarData }) {
  const [metric, setMetric] = useState<Metric>("replies");
  const [picked, setPicked] = useState<string | null>(null);

  const days = data.days;
  if (!days.length) return null;
  const lead = (new Date(`${days[0].date}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday-first
  const max = Math.max(...days.map((day) => day[metric]));
  const past = days.filter((day) => !day.future);
  const chosen = days.find((day) => day.date === (picked ?? data.today)) ?? past[past.length - 1] ?? days[0];

  const best = past.reduce<CalendarDay | null>((top, day) => (day.replies > (top?.replies ?? 0) ? day : top), null);
  const byWeekday = [0, 0, 0, 0, 0, 0, 0];
  for (const day of past) byWeekday[(new Date(`${day.date}T12:00:00Z`).getUTCDay() + 6) % 7] += day.replies;
  const DAY_NAMES = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
  const busiest = Math.max(...byWeekday) > 0 ? DAY_NAMES[byWeekday.indexOf(Math.max(...byWeekday))] : "—";
  const monthName = fmt(`${data.month}-01`, { month: "long" });
  const total = past.reduce((sum, day) => sum + day[metric], 0);

  return (
    <section className="panel ov-cal">
      <div className="panel-head">
        <h2>Reply calendar · {monthName}</h2>
        <div className="ov-cal-tabs" role="group" aria-label="What the squares show">
          {METRICS.map(([key, label]) => (
            <button key={key} type="button" className={metric === key ? "is-on" : ""} aria-pressed={metric === key} onClick={() => setMetric(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="ov-cal-body">
        <div className="ov-cal-grid-wrap">
          <div className="ov-cal-grid" onPointerLeave={() => setPicked(null)}>
            {WEEKDAYS.map((day) => <span key={day} className="ov-cal-dow">{day}</span>)}
            {Array.from({ length: lead }).map((_, i) => <span key={`b${i}`} />)}
            {days.map((day, i) => {
              const row = Math.floor((i + lead) / 7);
              const isToday = day.date === data.today;
              return (
                <button
                  key={day.date}
                  type="button"
                  disabled={day.future}
                  className={[
                    "ov-cal-day",
                    day.future ? "is-future" : `l${level(day[metric], metric, max)}`,
                    isToday ? "is-today" : "",
                    day.meetings && !day.future ? "has-meeting" : "",
                    chosen.date === day.date && picked ? "is-picked" : "",
                  ].join(" ")}
                  style={{ animationDelay: `${row * 0.08 + (i % 7) * 0.02}s` }}
                  aria-label={`${fmt(day.date, { weekday: "long", month: "long", day: "numeric" })}: ${day.replies} replies, ${day.positive} positive, ${day.meetings} meetings`}
                  onPointerEnter={() => !day.future && setPicked(day.date)}
                  onFocus={() => !day.future && setPicked(day.date)}
                  onClick={() => !day.future && setPicked(day.date)}
                >
                  {Number(day.date.slice(8))}
                </button>
              );
            })}
          </div>
          <div className="ov-cal-key" aria-hidden="true">
            Less <i className="l0" /><i className="l1" /><i className="l2" /><i className="l3" /><i className="l4" /> More
            <span className="ov-cal-key-meet"><b />meeting booked</span>
          </div>
        </div>

        <div className="ov-cal-side">
          <div className="ov-cal-card" aria-live="polite">
            <span className="ov-cal-card-date">
              {chosen.date === data.today ? "Today, so far · " : ""}{fmt(chosen.date, { weekday: "long", month: "long", day: "numeric" })}
            </span>
            <div className="ov-cal-card-figs">
              <span><b>{chosen.replies}</b> {chosen.replies === 1 ? "reply" : "replies"}</span>
              <span className="pos"><b>{chosen.positive}</b> positive</span>
              <span className="meet"><b>{chosen.meetings}</b> {chosen.meetings === 1 ? "meeting" : "meetings"}</span>
            </div>
          </div>
          <div className="ov-cal-facts">
            <div>
              <strong>
                <svg width="16" height="18" viewBox="0 0 24 24" aria-hidden="true" className="ov-cal-flame"><path d="M12 2c1 4 5 5.5 5 11a5 5 0 0 1-10 0c0-2.5 1.2-4 2.5-5 .2 1.8 1 3 2.2 3.4C11 9 10.6 5.6 12 2z" /></svg>
                {data.streak}
              </strong>
              <span>{data.streak === 1 ? "day" : "days"} in a row with a reply</span>
            </div>
            <div>
              <strong>{best ? best.replies : 0}</strong>
              <span>{best ? `best day (${fmt(best.date, { month: "short", day: "numeric" })})` : "best day"}</span>
            </div>
            <div>
              <strong>{busiest}</strong>
              <span>when most replies land</span>
            </div>
          </div>
          <span className="ov-cal-total">{total} {metric === "replies" ? (total === 1 ? "reply" : "replies") : metric === "positive" ? "positive" : total === 1 ? "meeting" : "meetings"} in {monthName} so far</span>
        </div>
      </div>
    </section>
  );
}
