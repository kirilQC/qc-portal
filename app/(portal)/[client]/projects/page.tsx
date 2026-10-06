// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { useEffect, useMemo, useState } from "react";
import { useClientSlug } from "../../../components/useClientSlug";
import { useCachedJson } from "../../../components/cache";
import "./projects.css";

/**
 * The Project tracker: QC Command's project board, as the client sees it.
 *
 * Read-only, and curated: only tasks the team marked "Show to client" in QC Command, with only their
 * title, stage, owner, priority and dates (see /api/projects). The team keeps working the board in QC
 * Command; this page reflects it. The stages, colours and layouts are QC Command's, so the two boards read
 * as the same thing — Kanban, By person and Table, the three that make sense for a single client.
 */

type Task = {
  id: string; title: string; stage: string; owner: string | null; priority: string | null;
  startDate: string | null; dueDate: string | null; updatedAt: string | null;
};
type Payload = { ok?: boolean; error?: string; tasks?: Task[]; isStaff?: boolean; setup?: string };
type View = "kanban" | "people" | "table";

// QC Command's stages and colours (app/project-management/Board.tsx), in board order.
const STAGES = [
  { key: "todo", label: "To do", color: "#6b7280" },
  { key: "planning", label: "Planning", color: "#8b93a7" },
  { key: "building", label: "Building", color: "#3fb0c9" },
  { key: "in_progress", label: "In progress", color: "#5aa9f0" },
  { key: "blocked", label: "Blocked", color: "#e5484d" },
  { key: "paused", label: "Paused", color: "#e0a83d" },
  { key: "completed", label: "Completed", color: "#3fb27f" },
  { key: "launched", label: "Launched", color: "#7c6cf0" },
  { key: "other", label: "Other", color: "#9a8cf0" },
];
const PRIORITIES = [
  { key: "p1", label: "Priority", color: "#ff2d6f" },
  { key: "high", label: "High", color: "#e5484d" },
  { key: "medium", label: "Medium", color: "#f2913d" },
  { key: "low", label: "Low", color: "#e6c229" },
];
const VIEWS: [View, string][] = [["kanban", "Kanban"], ["people", "By person"], ["table", "Table"]];
const VIEW_KEY = "qc-portal:projects-view";

const stageOf = (key: string) => STAGES.find((stage) => stage.key === key) ?? STAGES[STAGES.length - 1];
const prioOf = (key: string | null) => PRIORITIES.find((p) => p.key === key) ?? null;
const owners = (task: Task) => (task.owner ?? "").split(",").map((name) => name.trim()).filter(Boolean);

/** "Oct 8" — or "Oct 8, 2027" when it is not this year. Dates are stored as plain YYYY-MM-DD. */
function day(value: string | null): string {
  if (!value) return "";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

function Card({ task }: { task: Task }) {
  const stage = stageOf(task.stage);
  const prio = prioOf(task.priority);
  const people = owners(task);
  return (
    <article className="pt-card">
      <span className="pt-card-stripe" style={{ background: prio?.color ?? "var(--border)" }} />
      <div className="pt-card-head">
        <span className="pt-stage" style={{ color: stage.color, borderColor: `${stage.color}55` }}>{stage.label}</span>
        {prio && <span className="pt-prio" style={{ color: prio.color }}>● {prio.label}</span>}
      </div>
      <h3>{task.title}</h3>
      {(people.length > 0 || task.dueDate || task.startDate) && (
        <div className="pt-card-meta">
          {people.length > 0 && <span className="pt-owners">{people.join(", ")}</span>}
          {(task.startDate || task.dueDate) && (
            <span className="pt-dates">
              {task.startDate ? day(task.startDate) : ""}
              {task.startDate && task.dueDate ? " → " : ""}
              {task.dueDate ? `Due ${day(task.dueDate)}` : ""}
            </span>
          )}
        </div>
      )}
    </article>
  );
}

function Projects() {
  const clientSlug = useClientSlug();
  const query = new URLSearchParams();
  if (clientSlug) query.set("client", clientSlug);
  const { data, error } = useCachedJson<Payload>(`/api/projects?${query.toString()}`);

  const [view, setView] = useState<View>("kanban");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY) as View | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a remembered preference, read once on mount
      if (saved && VIEWS.some(([key]) => key === saved)) setView(saved);
    } catch { /* the default view is fine */ }
  }, []);
  const choose = (next: View) => {
    setView(next);
    try { window.localStorage.setItem(VIEW_KEY, next); } catch { /* a convenience only */ }
  };

  const tasks = useMemo(() => data?.tasks ?? [], [data]);
  const columns = useMemo(
    // Every working stage shows, empty or not, so the board keeps its shape; "Other" only when used.
    () => STAGES.filter((stage) => stage.key !== "other" || tasks.some((task) => task.stage === "other"))
      .map((stage) => ({ stage, tasks: tasks.filter((task) => stageOf(task.stage).key === stage.key) })),
    [tasks],
  );
  const byPerson = useMemo(() => {
    const groups = new Map<string, Task[]>();
    for (const task of tasks) {
      const names = owners(task);
      for (const name of names.length ? names : ["Unassigned"]) groups.set(name, [...(groups.get(name) ?? []), task]);
    }
    return [...groups.entries()].sort(([a], [b]) => (a === "Unassigned" ? 1 : b === "Unassigned" ? -1 : a.localeCompare(b)));
  }, [tasks]);

  if (error && !data) return <div className="content"><p className="error-note">{error}</p></div>;
  if (!data) return <div className="content"><p className="loading">Loading…</p></div>;

  return (
    <div className="content pt-wide">
      <div className="pt-head">
        <div>
          <h1>Project tracker</h1>
          <p className="pt-sub">
            {tasks.length ? `${tasks.length} ${tasks.length === 1 ? "project" : "projects"} your QC team is working on.` : "What your QC team is working on."}
          </p>
        </div>
        {tasks.length > 0 && (
          <div className="pt-views" role="tablist" aria-label="Layout">
            {VIEWS.map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={view === key} className={view === key ? "is-on" : ""} onClick={() => choose(key)}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {data.isStaff && (
        <p className="pt-staff-note">
          Staff view: clients see exactly this. Only tasks marked <b>Show to client</b> in QC Command appear, with their title, stage, owner, priority and dates.
          {data.setup ? ` ${data.setup}` : ""}
        </p>
      )}

      {tasks.length === 0 ? (
        <p className="empty">Nothing on your tracker yet. Your QC team will share projects here as they are planned.</p>
      ) : view === "kanban" ? (
        <div className="pt-board">
          {columns.map(({ stage, tasks: items }) => (
            <section className="pt-col" key={stage.key}>
              <header>
                <span className="pt-dot" style={{ background: stage.color }} />
                {stage.label}
                <span className="pt-count">{items.length}</span>
              </header>
              <div className="pt-col-body">
                {items.map((task) => <Card key={task.id} task={task} />)}
              </div>
            </section>
          ))}
        </div>
      ) : view === "people" ? (
        <div className="pt-people">
          {byPerson.map(([name, items]) => (
            <section className="pt-person" key={name}>
              <header>
                <span className="pt-avatar">{name === "Unassigned" ? "—" : name.slice(0, 1).toUpperCase()}</span>
                {name}
                <span className="pt-count">{items.length}</span>
              </header>
              <div className="pt-person-body">
                {items.map((task) => <Card key={`${name}-${task.id}`} task={task} />)}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="pt-table-wrap">
          <table className="pt-table">
            <thead>
              <tr><th>Project</th><th>Status</th><th>Owner</th><th>Priority</th><th>Start</th><th>Due</th></tr>
            </thead>
            <tbody>
              {tasks.map((task) => {
                const stage = stageOf(task.stage);
                const prio = prioOf(task.priority);
                return (
                  <tr key={task.id}>
                    <td className="pt-title-cell">{task.title}</td>
                    <td><span className="pt-stage" style={{ color: stage.color, borderColor: `${stage.color}55` }}>{stage.label}</span></td>
                    <td>{owners(task).join(", ") || "—"}</td>
                    <td>{prio ? <span style={{ color: prio.color }}>● {prio.label}</span> : "—"}</td>
                    <td>{day(task.startDate) || "—"}</td>
                    <td>{day(task.dueDate) || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return <Projects />;
}
