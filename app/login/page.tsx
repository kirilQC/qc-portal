// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { useEffect, useRef, useState } from "react";
import "./login.css";

/**
 * The sign-in screen — the first thing a client ever sees of QC as a product.
 *
 * ── Why it is a split rather than a card ────────────────────────────────────────────────────────
 * The form is a form: four controls, and making it interesting would only make it slower to use. The
 * right-hand panel is where the page gets to say what it is, and it says it with the product's own
 * subject — a field of points with a line drawn between any two that come close enough. Connections
 * being made is what the whole system is about, so the graphic is the thing rather than a stock
 * abstraction chosen to fill the space.
 *
 * ── Why there are no figures on it ──────────────────────────────────────────────────────────────
 * An earlier draft put the portfolio's totals here — "15,185 people reached". Two problems, and both
 * matter more than the panel looking busier. They are QC's numbers across every client, so a client
 * reading them before signing in would reasonably take them for their own. And putting them here means
 * an endpoint that hands out aggregate business figures to anybody who loads the login page. The
 * funnel legend says what the product does instead, makes no claim, and needs no data at all.
 */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error || "That email and password do not match.");
        setBusy(false);
        return;
      }
      // Only ever forwarded to a path on this site — an absolute or protocol-relative `next` is the
      // classic open redirect, and a login page is exactly where those get used.
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch {
      setError("Something went wrong signing in. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="login-split">
      <section className="login-form-side">
        <div className="login-inner">
          <div className="login-brand">
            <img className="login-mark" src="/qc-growth-logo.png" alt="" />
            <span className="login-wordmark">QC <b>Growth</b></span>
          </div>

          <h1>Sign in</h1>
          <p className="login-lede">Your outbound programme, kept up to date.</p>

          <form onSubmit={submit}>
            <div className="login-field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                className="login-input"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="login-field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                className="login-input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error && <p className="login-error" role="alert">{error}</p>}

            <button className="login-button" type="submit" disabled={busy || !email || !password}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="login-foot">Trouble signing in? Email your QC contact.</p>
        </div>
      </section>

      <aside className="login-art" aria-hidden="true">
        <Constellation />
        <div className="login-art-words">
          <p className="login-art-line">Every conversation after the first hello, in one place.</p>
          <div className="login-ramp">
            <i className="k-reached" /><i className="k-accepted" /><i className="k-replied" /><i className="k-positive" />
          </div>
          <div className="login-ramp-legend">
            <span>Reached</span><span>Accepted</span><span>Replied</span><span>Positive</span>
          </div>
        </div>
      </aside>
    </div>
  );
}

/**
 * A drifting field of points, with a line between any two that come close enough.
 *
 * Canvas rather than SVG because this is generative: the positions change every frame and the lines are
 * recomputed from them. Hand-authoring the path data for that is not possible, and animating a few
 * hundred SVG nodes is far more expensive than drawing them.
 *
 * `prefers-reduced-motion` is honoured by drawing a single still frame — the composition still reads,
 * nothing moves. The canvas is also decorative and sits inside an `aria-hidden` panel, so nothing here
 * is announced to a screen reader.
 */
function Constellation() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let frame = 0;
    let nodes: { x: number; y: number; vx: number; vy: number; r: number; warm: boolean }[] = [];

    const COUNT = 52;
    const LINK = 140;

    function seed() {
      if (!canvas || !context) return;
      const box = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      width = box.width;
      height = box.height;
      canvas.width = Math.max(1, width * ratio);
      canvas.height = Math.max(1, height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      nodes = Array.from({ length: COUNT }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.2,
        r: Math.random() * 1.6 + 0.9,
        // A handful are warm — the ones that replied. A uniform field would read as wallpaper.
        warm: Math.random() < 0.12,
      }));
    }

    function draw() {
      if (!context) return;
      context.clearRect(0, 0, width, height);

      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const distance = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
          if (distance > LINK) continue;
          // Nearer pairs draw a stronger line, which gives the field depth rather than a flat mesh.
          context.strokeStyle = `rgba(139,124,255,${(1 - distance / LINK) * 0.3})`;
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(nodes[i].x, nodes[i].y);
          context.lineTo(nodes[j].x, nodes[j].y);
          context.stroke();
        }
      }

      for (const node of nodes) {
        context.fillStyle = node.warm ? "rgba(99,223,164,.95)" : "rgba(186,178,255,.7)";
        context.beginPath();
        context.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        context.fill();

        if (still) continue;
        node.x += node.vx;
        node.y += node.vy;
        // Bounce rather than wrap: a point vanishing at one edge and reappearing at the other reads as
        // a glitch rather than as movement.
        if (node.x < 0 || node.x > width) node.vx *= -1;
        if (node.y < 0 || node.y > height) node.vy *= -1;
      }

      if (!still) frame = requestAnimationFrame(draw);
    }

    seed();
    draw();

    const observer = new ResizeObserver(() => {
      seed();
      if (still) draw();
    });
    observer.observe(canvas);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return <canvas className="login-canvas" ref={ref} />;
}
