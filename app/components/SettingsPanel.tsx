// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";
/* eslint-disable react-hooks/set-state-in-effect -- the panel loads the account on mount; the setState
   calls are inside an async callback rather than the effect body, and there is nothing to derive them
   from. */

import { useCallback, useEffect, useState } from "react";

/**
 * Settings: your own details, your team, and how the portal looks.
 *
 * A sheet rather than a dropdown, because it holds three forms. Everything here acts on the signed-in
 * account only — the role and workspace an invitation lands on come from the session on the server, so
 * nothing typed into this panel can widen anybody's access.
 */
type Account = { name: string; email: string; role: "staff" | "client" };
type Colleague = { id: string; name: string; email: string; isActive: boolean };

/** Generated locally so an inviter never has to invent a password. Ambiguous glyphs removed. */
function suggestPassword(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

const THEME_KEY = "qc-portal:theme";

/** Applied to <body>, which is what globals.css keys the light palette off. */
export function applyTheme(theme: "dark" | "light") {
  document.body.classList.toggle("light-mode", theme === "light");
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* the preference is a convenience */
  }
}

export function readTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "dark";
  try {
    return window.localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [colleagues, setColleagues] = useState<Colleague[]>([]);
  // Read in the initialiser rather than an effect: localStorage is available synchronously on the
  // client, and the panel only ever mounts there.
  const [theme, setTheme] = useState<"dark" | "light">(() => readTheme());

  const [form, setForm] = useState({ name: "", email: "", currentPassword: "", newPassword: "" });
  const [invite, setInvite] = useState({ name: "", email: "" });
  const [invited, setInvited] = useState<{ email: string; password: string } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/account", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error || "That did not load.");
        return;
      }
      setAccount(payload.account);
      setColleagues(payload.colleagues ?? []);
      setForm((was) => ({ ...was, name: payload.account?.name ?? "", email: payload.account?.email ?? "" }));
    } catch {
      setError("That did not load.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/account", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error || "That could not be saved.");
        return;
      }
      setMessage(form.newPassword ? "Saved. Your password has been changed." : "Saved.");
      setForm((was) => ({ ...was, currentPassword: "", newPassword: "" }));
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function sendInvite(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    const password = suggestPassword();
    try {
      const response = await fetch("/api/account", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...invite, password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error || "That invitation could not be created.");
        return;
      }
      setInvited({ email: invite.email, password });
      setInvite({ name: "", email: "" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop">
      <button className="sheet-scrim" aria-label="Close settings" onClick={onClose} />
      <section className="sheet" role="dialog" aria-label="Settings">
        <header className="sheet-head">
          <h2>Settings</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="sheet-body">
          {error && <p className="error-note">{error}</p>}
          {message && <p className="ok-note">{message}</p>}

          <section className="sheet-section">
            <h3>Appearance</h3>
            <div className="theme-toggle">
              {(["dark", "light"] as const).map((option) => (
                <button
                  key={option}
                  className={theme === option ? "selected" : ""}
                  onClick={() => { setTheme(option); applyTheme(option); }}
                >
                  {option === "dark" ? "Dark" : "Light"}
                </button>
              ))}
            </div>
          </section>

          <form className="sheet-section" onSubmit={save}>
            <h3>Your account</h3>
            <div className="sheet-grid">
              <div className="field">
                <label htmlFor="s-name">Name</label>
                <input id="s-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="s-email">Email</label>
                <input id="s-email" className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="s-current">Current password</label>
                <input
                  id="s-current"
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Only needed to change your password"
                  value={form.currentPassword}
                  onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="s-new">New password</label>
                <input
                  id="s-new"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 12 characters"
                  value={form.newPassword}
                  onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
                />
              </div>
            </div>
            <button className="button primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
          </form>

          {account?.role === "client" && (
            <>
              <form className="sheet-section" onSubmit={sendInvite}>
                <h3>Invite a colleague</h3>
                <p className="sheet-note">They get their own login to this portal, seeing exactly what you see.</p>
                <div className="sheet-grid">
                  <div className="field">
                    <label htmlFor="i-name">Name</label>
                    <input id="i-name" className="input" value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor="i-email">Email</label>
                    <input id="i-email" className="input" type="email" required value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
                  </div>
                </div>
                <button className="button primary" type="submit" disabled={busy || !invite.email}>
                  {busy ? "Creating…" : "Create their login"}
                </button>

                {invited && (
                  <div className="invite-result">
                    <strong>Password for {invited.email}</strong>
                    <code>{invited.password}</code>
                    <button type="button" className="button ghost small" onClick={() => void navigator.clipboard?.writeText(invited.password).catch(() => {})}>
                      Copy
                    </button>
                    <span>Shown once — send it to them, then close this.</span>
                  </div>
                )}
              </form>

              {colleagues.length > 0 && (
                <section className="sheet-section">
                  <h3>Your team</h3>
                  <ul className="team-list">
                    {colleagues.map((person) => (
                      <li key={person.id}>
                        <span>
                          <strong>{person.name || person.email}</strong>
                          <small>{person.email}</small>
                        </span>
                        {!person.isActive && <span className="pill off">Off</span>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
