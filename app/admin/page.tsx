// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";
/* eslint-disable react-hooks/set-state-in-effect -- the initial load has to happen on mount; there is
   nothing to derive it from, and the setState is inside an async callback rather than the effect body. */

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Shell from "../components/Shell";

/**
 * Who can sign in, and as what. Staff only — the middleware and the API both refuse anyone else.
 *
 * ── Why the password is shown once, here, and never again ───────────────────────────────────────
 * Passwords are stored as PBKDF2 hashes and cannot be read back, which is the point. So when a login is
 * created the password is displayed on this screen exactly once, to be copied and sent to the client
 * over whatever channel QC already uses with them. Losing it means resetting it, not recovering it.
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

function Admin() {
  const [users, setUsers] = useState<User[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

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
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function toggle(user: User) {
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: user.id, isActive: !user.isActive }),
    }).catch(() => {});
    await load();
  }

  async function reset(user: User) {
    const password = suggestPassword();
    const response = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: user.id, password }),
    }).catch(() => null);
    if (response?.ok) setCreated({ email: user.email, password });
    await load();
  }

  async function remove(user: User) {
    // Typing the email is the confirmation — a login is somebody's access, and a stray click on the
    // wrong row should not be able to take it away.
    const typed = window.prompt(`Type ${user.email} to delete this login.`);
    if (typed !== user.email) return;
    await fetch(`/api/admin/users?id=${encodeURIComponent(user.id)}`, { method: "DELETE" }).catch(() => {});
    await load();
  }

  return (
    <div className="content">
      <div className="page-head">
        <span className="eyebrow">QC team</span>
        <h1>Admin</h1>
      </div>

      <div className="ops-tabs">
        <span className="ops-tab active">Logins</span>
        <Link href="/admin/ops" className="ops-tab">System health</Link>
      </div>

      {error && <p className="error-note" style={{ marginBottom: 20 }}>{error}</p>}

      {created && (
        <div className="panel" style={{ marginBottom: 22 }}>
          <div className="panel-head">
            <h2>Password for {created.email}</h2>
            <button className="button ghost small" onClick={() => setCreated(null)}>Done</button>
          </div>
          <div style={{ padding: 20, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <code style={{ fontSize: 16, letterSpacing: "0.04em", padding: "10px 14px", background: "var(--panel-2)", borderRadius: 10 }}>
              {created.password}
            </code>
            <button
              className="button ghost small"
              onClick={() => void navigator.clipboard?.writeText(created.password).catch(() => {})}
            >
              Copy
            </button>
            <span style={{ fontSize: 12, color: "var(--muted-2)" }}>
              Shown once. Send it to them, then close this.
            </span>
          </div>
        </div>
      )}

      <div className="panel" style={{ marginBottom: 22 }}>
        <div className="panel-head"><h2>Add a login</h2></div>
        <form
          onSubmit={create}
          style={{ padding: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 14, alignItems: "end" }}
        >
          <div className="field">
            <label htmlFor="a-email">Email</label>
            <input id="a-email" className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="a-name">Name</label>
            <input id="a-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="a-role">Role</label>
            <select id="a-role" className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="client">Client — one company only</option>
              <option value="staff">QC team — every client</option>
            </select>
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
            <label htmlFor="a-pass">Password</label>
            <input id="a-pass" className="input" placeholder="Leave blank to generate" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create login"}
          </button>
        </form>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>All logins</h2>
          <span>{users.length}</span>
        </div>
        {!loaded ? (
          <p className="loading">Loading…</p>
        ) : users.length === 0 ? (
          <p className="empty">No logins yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="rows">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Sees</th>
                  <th>Status</th>
                  <th className="num">Last signed in</th>
                  <th className="num">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <span className="primary">{user.name || user.email}</span>
                      <span className="sub">{user.email}</span>
                    </td>
                    <td>
                      {user.role === "staff" ? (
                        <span className="pill staff">Every client</span>
                      ) : (
                        <span className="pill client">{user.workspaceName || "Unknown client"}</span>
                      )}
                    </td>
                    <td>
                      <span className={`pill ${user.isActive ? "active" : "off"}`}>{user.isActive ? "Active" : "Off"}</span>
                    </td>
                    <td className="num">
                      {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Never"}
                    </td>
                    <td className="num" style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                      <button className="button ghost small" onClick={() => void reset(user)}>Reset password</button>
                      <button className="button ghost small" onClick={() => void toggle(user)}>{user.isActive ? "Switch off" : "Switch on"}</button>
                      <button className="button danger small" onClick={() => void remove(user)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="loading">Loading…</div>}>
      <Shell>
        <Admin />
      </Shell>
    </Suspense>
  );
}
