// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";
/* eslint-disable react-hooks/set-state-in-effect -- the stored appearance is read on mount and
   applied; localStorage is an external system and there is nothing to derive it from. */

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The appearance popover, matching Reply Radar's: mode, zoom, font, time zone, background and accent.
 *
 * ── Why these settings and not a single dark/light switch ───────────────────────────────────────
 * Zoom and font are accessibility settings, and the time zone is a correctness one — a reply that
 * landed at 9:38pm Eastern should not read as 6:38pm because the reader's laptop is in California.
 * Reply Radar lets a person fix all of that, and a client-facing surface has more need of it, not less.
 *
 * ── Stored on the device, not the account ───────────────────────────────────────────────────────
 * Reply Radar syncs these to a profile; here they live in localStorage. That is a deliberate smaller
 * promise: it is honest about being per-device, and it avoids a write to the database on every nudge
 * of a zoom slider. The panel says so, so nobody expects otherwise.
 */
export type Appearance = {
  mode: "dark" | "light";
  zoom: number;
  font: string;
  timeZone: string;
  background: string;
  accent: string;
};

const KEY = "qc-portal:appearance";

export const DEFAULT_APPEARANCE: Appearance = {
  mode: "dark",
  zoom: 100,
  font: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif",
  timeZone: "America/New_York",
  background: "#0b0c10",
  accent: "#8b7cff",
};

const FONTS: [string, string][] = [
  ["Inter / System", "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"],
  ["System UI", "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"],
  ["Georgia / Serif", "Georgia, 'Times New Roman', serif"],
  ["Monospace", "ui-monospace, SFMono-Regular, Menlo, monospace"],
];

const ZONES: [string, string][] = [
  ["Eastern Time — New York", "America/New_York"],
  ["Central Time — Chicago", "America/Chicago"],
  ["Mountain Time — Denver", "America/Denver"],
  ["Pacific Time — Los Angeles", "America/Los_Angeles"],
  ["UTC", "UTC"],
  ["London", "Europe/London"],
  ["Central European — Berlin", "Europe/Berlin"],
];

export function readAppearance(): Appearance {
  if (typeof window === "undefined") return DEFAULT_APPEARANCE;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_APPEARANCE, ...(JSON.parse(raw) as Partial<Appearance>) } : DEFAULT_APPEARANCE;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

/**
 * Puts an appearance into effect.
 *
 * Everything is a CSS custom property on the root element, which is what the stylesheet already reads —
 * so a change lands everywhere at once without a re-render. Light mode additionally *removes* the
 * background override rather than setting it, or a dark background chosen earlier would survive the
 * switch and leave dark-on-light text.
 */
export function applyAppearance(appearance: Appearance) {
  const root = document.documentElement;
  root.style.setProperty("--accent", appearance.accent);
  root.style.setProperty("--font", appearance.font);
  root.style.setProperty("--zoom", String(appearance.zoom / 100));
  document.body.classList.toggle("light-mode", appearance.mode === "light");
  if (appearance.mode === "light") root.style.removeProperty("--bg");
  else root.style.setProperty("--bg", appearance.background);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(appearance));
  } catch {
    /* the preference is a convenience, not a requirement */
  }
}

/** The time zone every date on screen is rendered in. */
export function activeTimeZone(): string {
  return readAppearance().timeZone;
}

export default function AppearanceControl() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [saved, setSaved] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const current = readAppearance();
    setDraft(current);
    applyAppearance(current);
  }, []);

  // Clicking away closes it, which is what a popover is expected to do.
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  /** Preview as you go — a colour picker you cannot see the effect of is a guess. */
  const preview = useCallback((next: Appearance) => {
    setDraft(next);
    applyAppearance(next);
    setSaved(false);
  }, []);

  return (
    <div className="appearance-wrap" ref={wrap}>
      <button
        className={`icon-button ${open ? "is-open" : ""}`}
        onClick={() => setOpen((was) => !was)}
        title="Appearance"
        aria-label="Appearance"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3v18a9 9 0 0 0 0-18" fill="currentColor" stroke="none" />
        </svg>
      </button>

      {open && (
        <div className="appearance-panel" role="dialog" aria-label="Appearance">
          <header>
            <div>
              <h3>Appearance</h3>
              <small>Saved to this device.</small>
            </div>
            <span className="appearance-dot" aria-hidden="true" />
          </header>

          <label className="appearance-field">
            <span>Mode</span>
            <select value={draft.mode} onChange={(event) => preview({ ...draft, mode: event.target.value as "dark" | "light" })}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>

          <div className="appearance-field">
            <span className="appearance-zoom-label">
              Zoom <b>{draft.zoom}%</b>
            </span>
            <input
              type="range"
              min={80}
              max={140}
              step={5}
              value={draft.zoom}
              onChange={(event) => preview({ ...draft, zoom: Number(event.target.value) })}
            />
          </div>

          <label className="appearance-field">
            <span>Font</span>
            <select value={draft.font} onChange={(event) => preview({ ...draft, font: event.target.value })}>
              {FONTS.map(([label, value]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <label className="appearance-field">
            <span>Dashboard time zone</span>
            <select value={draft.timeZone} onChange={(event) => preview({ ...draft, timeZone: event.target.value })}>
              {ZONES.map(([label, value]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <small>Used for reply dates and conversation timestamps.</small>
          </label>

          <div className="appearance-colors">
            <label className="appearance-field">
              <span>Background</span>
              <input type="color" value={draft.background} onChange={(event) => preview({ ...draft, background: event.target.value })} />
            </label>
            <label className="appearance-field">
              <span>Accent</span>
              <input type="color" value={draft.accent} onChange={(event) => preview({ ...draft, accent: event.target.value })} />
            </label>
          </div>

          <div className="appearance-actions">
            <button className="button ghost small" onClick={() => preview(DEFAULT_APPEARANCE)}>Reset</button>
            <button
              className="button primary"
              onClick={() => { applyAppearance(draft); setSaved(true); window.setTimeout(() => setOpen(false), 450); }}
            >
              {saved ? "Saved ✓" : "Save appearance"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
