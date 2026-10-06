// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

/**
 * The reply calendar: this month, one square per day, shaded by how many people replied.
 *
 * Deliberately just the picture — a heat map of replies; hovering a day shows its replies and how many were positive. It answers "have we
 * been hearing from people every day?" at a glance; the exact numbers live in the activity chart above.
 * The squares light up row by row on load, today pulses, and days still to come are dashed outlines
 * rather than zeros. Counts come from the server exactly as the chart counts them (a person once a day).
 */

export type CalendarDay = { date: string; replies: number; positive: number; meetings: number; future: boolean };
export type CalendarData = { month: string; today: string; days: CalendarDay[]; streak: number };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Shade 0–4 against the busiest day of the month. */
function level(value: number, max: number): number {
  if (value <= 0) return 0;
  const share = value / Math.max(max, 1);
  return share > 0.75 ? 4 : share > 0.5 ? 3 : share > 0.25 ? 2 : 1;
}

export default function ReplyCalendar({ data }: { data: CalendarData }) {
  const days = data.days;
  if (!days.length) return null;
  const lead = (new Date(`${days[0].date}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday-first
  const max = Math.max(...days.map((day) => day.replies));
  const total = days.reduce((sum, day) => sum + day.replies, 0);
  const monthName = new Date(`${data.month}-01T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long" });

  return (
    <section className="panel ov-cal">
      <div className="panel-head">
        <h2>Reply calendar · {monthName}</h2>
        <span>{total} {total === 1 ? "reply" : "replies"} so far</span>
      </div>
      <div className="ov-cal-body">
        <div className="ov-cal-grid" role="img" aria-label={`Replies each day of ${monthName}: ${total} so far`}>
          {WEEKDAYS.map((day) => <span key={day} className="ov-cal-dow">{day}</span>)}
          {Array.from({ length: lead }).map((_, i) => <span key={`b${i}`} />)}
          {days.map((day, i) => (
            <span
              key={day.date}
              className={`ov-cal-day ${day.future ? "is-future" : `l${level(day.replies, max)}`} ${day.date === data.today ? "is-today" : ""}`}
              style={{ animationDelay: `${Math.floor((i + lead) / 7) * 0.08 + ((i + lead) % 7) * 0.02}s` }}
            >
              {Number(day.date.slice(8))}
              {!day.future && (
                <span className="ov-cal-tip" role="tooltip">
                  <b>{new Date(`${day.date}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })}</b>
                  <span>{day.replies} {day.replies === 1 ? "reply" : "replies"}</span>
                  <span className="pos">{day.positive} positive</span>
                </span>
              )}
            </span>
          ))}
        </div>
        <div className="ov-cal-key" aria-hidden="true">
          Less <i className="l0" /><i className="l1" /><i className="l2" /><i className="l3" /><i className="l4" /> More
        </div>
      </div>
    </section>
  );
}
