// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";
/* eslint-disable react-hooks/set-state-in-effect -- the initial load has to happen on mount; there is
   nothing to derive it from, and the setState is inside an async callback rather than the effect body. */

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import "./admin.css";

/**
 * Who can sign in, and as what. Staff only — the middleware and the API both refuse anyone else.
 *
 * ── Why the password is shown once, here, and never again ───────────────────────────────────────
 * Passwords are stored as PBKDF2 hashes and cannot be read back, which is the point. So when a login is
 * created the password is displayed on this screen exactly once, to be copied and sent to the client
 * over whatever channel QC already uses with them. Losing it means resetting it, not recovering it.
 *
 * ── The roster, not a flat table ────────────────────────────────────────────────────────────────
 * Staff who see every client and clients who see one company are different kinds of account with
 * different blast radius, so they are grouped rather than mixed. A login that has never signed in is
 * the one row worth noticing — a fresh invite, or a password that never reached somebody — so it is
 * called out rather than left to look like a date. And the row's own account never shows the controls
 * that would lock it out; the server refuses them too, because a hidden button is not a rule.
 */
type User = {
  id: string;
  email: string;
  role: "staff" | "client";
  workspaceId: string | null;
  name: string;
  isActive: boolean;
  lastLoginAt: string | null;
  workspaceName?: string;
};
type ClientRow = { id: string; name: string; slug: string };

/**
 * A password nobody has to invent.
 *
 * Generated in the browser from the platform's CSPRNG, from an alphabet with the characters that get
 * misread out of a phone call removed — no O/0, no l/1/I. Twenty characters at this alphabet is far
 * beyond anything guessable, and the client never has to think of one.
 */
function suggestPassword(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

function initials(name: string, email: string): string {
  const source = name.trim() || email;
  const words = source.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function Admin() {
  const [users, setUsers] = useState<User[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [meId, setMeId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [resetting, setResetting] = useState<{ user: User; password: string } | null>(null);
  /** The invite form is behind a button rather than a permanent panel — the page is mostly a list. */
  const [inviting, setInviting] = useState(false);
  /** Which row's ⋯ menu is open. Only one at a time. */
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const [form, setForm] = useState({ email: "", name: "", role: "client", workspaceId: "", password: "" });

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error || "That did not load.");
        return;
      }
      setUsers(payload.users ?? []);
      setClients(payload.clients ?? []);
      setMeId(payload.meId ?? "");
    } catch {
      setError("That did not load.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const password = form.password || suggestPassword();
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error || "That login could not be created.");
        return;
      }
      setCreated({ email: form.email, password });
      setForm({ email: "", name: "", role: "client", workspaceId: "", password: "" });
      setInviting(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function toggle(user: User) {
    setMenuFor(null);
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: user.id, isActive: !user.isActive }),
    }).catch(() => {});
    await load();
  }

  /**
   * Resetting somebody else's password.
   *
   * Two steps on purpose. A single click that generates and applies a new password means a mis-click
   * silently locks somebody out with no way back — the old password cannot be recovered, only replaced.
   * So the row opens a small form: choose or generate a password, and confirm whose it is before it is
   * applied.
   */
  async function applyReset(user: User, password: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: user.id, password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error || "That password could not be set.");
        return;
      }
      setCreated({ email: user.email, password });
      setResetting(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(user: User) {
    setMenuFor(null);
    // Typing the email is the confirmation — a login is somebody's access, and a stray click on the
    // wrong row should not be able to take it away.
    const typed = window.prompt(`Type ${user.email} to delete this login.`);
    if (typed !== user.email) return;
    await fetch(`/api/admin/users?id=${encodeURIComponent(user.id)}`, { method: "DELETE" }).catch(() => {});
    await load();
  }

  const staff = users.filter((user) => user.role === "staff");
  const clientUsers = users.filter((user) => user.role !== "staff");
  const neverIn = users.filter((user) => !user.lastLoginAt).length;

  return (
    <div className="content">
      <div className="page-head adm-head">
        <h1>Admin</h1>
        <button className="button primary adm-invite-btn" onClick={() => setInviting(true)}>+ Add a login</button>
      </div>

      <div className="ops-tabs">
        <span className="ops-tab active">Logins</span>
        <Link href="/admin/ops" className="ops-tab">System health</Link>
      </div>

      {error && <p className="error-note" style={{ marginBottom: 20 }}>{error}</p>}

      {/* The one-time password, shared by create and reset. Green, because it is a thing that worked. */}
      {created && (
        <div className="adm-reveal">
          <code className="adm-key">{created.password}</code>
          <button
            className="button ghost small"
            onClick={() => void navigator.clipboard?.writeText(created.password).catch(() => {})}
          >
            Copy
          </button>
          <span className="adm-reveal-msg">
            Password for <b>{created.email}</b> · shown once — send it, then dismiss.
          </span>
          <button className="adm-reveal-x" aria-label="Dismiss" onClick={() => setCreated(null)}>✕</button>
        </div>
      )}

      {!loaded ? (
        <p className="loading">Loading…</p>
      ) : users.length === 0 ? (
        <p className="empty">No logins yet. Add one to get started.</p>
      ) : (
        <>
          <div className="adm-stats">
            <div><b>{staff.length}</b><span>QC staff</span></div>
            <div><b>{clientUsers.length}</b><span>client{clientUsers.length === 1 ? "" : "s"}</span></div>
            {neverIn > 0 && <div className="adm-stat-flag"><b>{neverIn}</b><span>never signed in</span></div>}
          </div>

          {staff.length > 0 && (
            <Group label="QC staff · sees every client" count={staff.length}>
              {staff.map((user) => (
                <Row key={user.id} user={user} isMe={user.id === meId}
                  onReset={() => setResetting({ user, password: "" })}
                  onToggle={() => void toggle(user)} onRemove={() => void remove(user)}
                  menuOpen={menuFor === user.id} onMenu={() => setMenuFor(menuFor === user.id ? null : user.id)} />
              ))}
            </Group>
          )}

          {clientUsers.length > 0 && (
            <Group label="Client logins · one company each" count={clientUsers.length}>
              {clientUsers.map((user) => (
                <Row key={user.id} user={user} isMe={user.id === meId}
                  onReset={() => setResetting({ user, password: "" })}
                  onToggle={() => void toggle(user)} onRemove={() => void remove(user)}
                  menuOpen={menuFor === user.id} onMenu={() => setMenuFor(menuFor === user.id ? null : user.id)} />
              ))}
            </Group>
          )}
        </>
      )}

      {/* ── The invite sheet ── */}
      {inviting && (
        <div className="sheet-backdrop">
          <button className="sheet-scrim" aria-label="Cancel" onClick={() => setInviting(false)} />
          <section className="confirm-card adm-invite" role="dialog" aria-label="Add a login">
            <h2>Add a login</h2>
            <p>They get a one-time password to show here — send it to them however you already talk.</p>
            <form onSubmit={create} className="adm-form">
              <div className="field">
                <span className="label">Access</span>
                <div className="adm-seg">
                  <button type="button" className={form.role === "staff" ? "on" : ""} onClick={() => setForm({ ...form, role: "staff", workspaceId: "" })}>QC staff — every client</button>
                  <button type="button" className={form.role === "client" ? "on" : ""} onClick={() => setForm({ ...form, role: "client" })}>One client</button>
                </div>
              </div>
              {form.role === "client" && (
                <div className="field">
                  <label htmlFor="a-client">Client</label>
                  <select id="a-client" className="input" required value={form.workspaceId} onChange={(e) => setForm({ ...form, workspaceId: e.target.value })}>
                    <option value="">— pick a client —</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>{client.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field">
                <label htmlFor="a-email">Email</label>
                <input id="a-email" className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="a-name">Name <span className="adm-opt">optional</span></label>
                <input id="a-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="a-pass">Password <span className="adm-opt">blank to generate</span></label>
                <input id="a-pass" className="input" placeholder="Leave blank for a strong one" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
              <div className="confirm-actions">
                <button type="button" className="button ghost" onClick={() => setInviting(false)}>Cancel</button>
                <button className="button primary" type="submit" disabled={busy}>{busy ? "Creating…" : "Create login"}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* ── The reset sheet ── */}
      {resetting && (
        <div className="sheet-backdrop">
          <button className="sheet-scrim" aria-label="Cancel" onClick={() => setResetting(null)} />
          <section className="confirm-card" role="dialog" aria-label="Reset password">
            <h2>Reset the password for {resetting.user.name || resetting.user.email}?</h2>
            <p>Their current password stops working immediately and cannot be recovered. You will need to send them the new one.</p>
            <div className="field">
              <label htmlFor="r-pass">New password</label>
              <input id="r-pass" className="input" value={resetting.password} placeholder="At least 12 characters"
                onChange={(event) => setResetting({ ...resetting, password: event.target.value })} />
            </div>
            <button className="button ghost small" onClick={() => setResetting({ ...resetting, password: suggestPassword() })}>Generate one for me</button>
            <div className="confirm-actions">
              <button className="button ghost" onClick={() => setResetting(null)}>Cancel</button>
              <button className="button primary" disabled={busy || resetting.password.trim().length < 12}
                onClick={() => void applyReset(resetting.user, resetting.password)}>
                {busy ? "Setting…" : "Set this password"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function Group({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <section className="adm-group">
      <div className="adm-group-head">
        <span>{label}</span>
        <span className="adm-group-n">{count}</span>
      </div>
      {children}
    </section>
  );
}

function Row({ user, isMe, onReset, onToggle, onRemove, menuOpen, onMenu }: {
  user: User; isMe: boolean;
  onReset: () => void; onToggle: () => void; onRemove: () => void;
  menuOpen: boolean; onMenu: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(event.target as Node)) onMenu(); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen, onMenu]);

  const last = user.lastLoginAt
    ? new Date(user.lastLoginAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;

  return (
    <div className={`adm-row ${user.isActive ? "" : "is-off"}`}>
      <div className="adm-who">
        <span className={`adm-av ${user.role === "staff" ? "is-staff" : ""}`}>{initials(user.name, user.email)}</span>
        <span className="adm-who-t">
          <b>{user.name || user.email}{isMe && <span className="adm-you">you</span>}</b>
          <small>{user.email}</small>
        </span>
      </div>

      <span className={`adm-sees pill ${user.role === "staff" ? "staff" : "client"}`}>
        {user.role === "staff" ? "Every client" : (user.workspaceName || "Unknown client")}
      </span>

      {/* "Never" is the one status worth noticing — a fresh invite or a password that never landed. */}
      {last ? (
        <span className="adm-last">{last}</span>
      ) : (
        <span className="adm-last is-never">Never signed in</span>
      )}

      <div className="adm-actions">
        {!user.isActive && <span className="pill off">Off</span>}
        <button className="button ghost small" onClick={onReset}>Reset</button>
        {/* A login cannot switch itself off or delete itself; those two live in the menu, and vanish on
            your own row. Reset stays — you can always change your own password. */}
        {!isMe && (
          <div className="adm-menu-wrap" ref={menuRef}>
            <button className="adm-menu-btn" aria-label="More" onClick={onMenu}>⋯</button>
            {menuOpen && (
              <div className="adm-menu" role="menu">
                <button onClick={onToggle}>{user.isActive ? "Switch off" : "Switch on"}</button>
                <button className="is-danger" onClick={onRemove}>Delete login</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Admin />
    </Suspense>
  );
}
