// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { useEffect, useRef, useState } from "react";
import "./login.css";

/**
 * The sign-in screen — the first thing a client ever sees of QC as a product.
 *
 * ── Why it is a split rather than a card ────────────────────────────────────────────────────────
 * The form is a form: three controls, and making it interesting would only make it slower to use. The
 * right-hand panel is where the page gets to say what it is, and it says it with the product's own
 * subject — a network in which messages travel and a few of them come back warm.
 *
 * ── Why there are no figures on it ──────────────────────────────────────────────────────────────
 * An earlier draft put the portfolio's totals here — "15,185 people reached". Two problems. They are
 * QC's numbers across every client, so a client reading them before signing in would reasonably take
 * them for their own. And serving them means an endpoint that hands aggregate business figures to
 * anybody who loads the login page. The funnel legend says what the product does instead, makes no
 * claim, and needs no data at all.
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
          {/* The real banner lockup, keyed to transparency so the grey "C" keeps its weight against the
              page ground rather than carrying the JPEG's own near-black rectangle with it. */}
          <img className="login-banner" src="/qc-growth-banner.png" alt="QC Growth" />

          <h1>Sign in</h1>

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

/* ── The network ──────────────────────────────────────────────────────────────────────────────────
 *
 * A drifting field of points, with a line between any two that come close enough — and, every second
 * or so, a message travelling down one of those lines. Where it lands, the node warms and gives off a
 * ring, then cools back over the next several seconds.
 *
 * The first version of this panel was only the field, and it read as wallpaper: pretty, ambient,
 * nothing to catch the eye. What it lacked was an *event*. Outbound is not a static graph, it is
 * messages going out and a small fraction coming back warm, so the pulse is the thing the picture is
 * actually about and the drifting field is only the stage it happens on. Roughly a third of arrivals
 * warm their target, which is both a better rhythm than every-one-lands and closer to the truth.
 *
 * Canvas rather than SVG because this is generative: positions change every frame and the edges are
 * recomputed from them, so there is no path data to hand-author, and animating a few hundred SVG nodes
 * costs far more than drawing them.
 *
 * `prefers-reduced-motion` draws a single still frame, with a share of nodes pre-warmed so the
 * composition still reads. Nothing moves, and no pulses are ever scheduled.
 */

type Node = { x: number; y: number; vx: number; vy: number; r: number; heat: number };
type Pulse = { from: number; to: number; t: number; speed: number; lands: boolean };
type Ring = { x: number; y: number; age: number };

const COUNT = 64;
const LINK = 132;          // px within which two nodes draw an edge
const PULSE_EVERY = 46;    // frames between launches — ~0.75s, frequent enough to notice, rare enough to be an event
const MAX_PULSES = 7;
const RING_LIFE = 46;      // frames for an arrival ring to expand and fade out
const COOL = 0.006;        // per-frame heat decay: a warmed node stays warm ~3s

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
    let tick = 0;
    let nodes: Node[] = [];
    let pulses: Pulse[] = [];
    let rings: Ring[] = [];

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
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        r: Math.random() * 1.5 + 0.9,
        // With motion, heat is earned by an arriving pulse. Without it, seed a few so the still frame
        // is not a uniform field of identical dots.
        heat: still && Math.random() < 0.12 ? 1 : 0,
      }));
      pulses = [];
      rings = [];
    }

    /** Launch a message down a currently-linked edge, picked at random from the live graph. */
    function launch() {
      if (pulses.length >= MAX_PULSES) return;
      const from = Math.floor(Math.random() * nodes.length);
      const candidates: number[] = [];
      for (let i = 0; i < nodes.length; i += 1) {
        if (i === from) continue;
        if (Math.hypot(nodes[i].x - nodes[from].x, nodes[i].y - nodes[from].y) <= LINK) candidates.push(i);
      }
      if (!candidates.length) return;
      pulses.push({
        from,
        to: candidates[Math.floor(Math.random() * candidates.length)],
        t: 0,
        speed: 0.012 + Math.random() * 0.01,
        // Only some arrivals warm their target — most outreach does not come back.
        lands: Math.random() < 0.34,
      });
    }

    function draw() {
      if (!context) return;
      context.clearRect(0, 0, width, height);

      // Edges first, so every node and pulse sits on top of the mesh rather than being crossed by it.
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const distance = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
          if (distance > LINK) continue;
          // Nearer pairs draw a stronger line, which gives the field depth rather than a flat mesh.
          context.strokeStyle = `rgba(139,124,255,${(1 - distance / LINK) * 0.26})`;
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(nodes[i].x, nodes[i].y);
          context.lineTo(nodes[j].x, nodes[j].y);
          context.stroke();
        }
      }

      // Arrival rings, under the nodes so a ring never washes out the dot that threw it.
      rings = rings.filter((ring) => {
        const life = ring.age / RING_LIFE;
        context.strokeStyle = `rgba(99,223,164,${(1 - life) * 0.5})`;
        context.lineWidth = 1.2;
        context.beginPath();
        context.arc(ring.x, ring.y, 3 + life * 26, 0, Math.PI * 2);
        context.stroke();
        ring.age += still ? 0 : 1;
        return ring.age < RING_LIFE;
      });

      // Messages in flight: a lit segment of the edge behind a bright head.
      pulses = pulses.filter((pulse) => {
        const a = nodes[pulse.from];
        const b = nodes[pulse.to];
        const x = a.x + (b.x - a.x) * pulse.t;
        const y = a.y + (b.y - a.y) * pulse.t;
        const trail = Math.max(0, pulse.t - 0.22);

        context.strokeStyle = "rgba(167,152,255,.5)";
        context.lineWidth = 1.4;
        context.beginPath();
        context.moveTo(a.x + (b.x - a.x) * trail, a.y + (b.y - a.y) * trail);
        context.lineTo(x, y);
        context.stroke();

        context.fillStyle = "rgba(214,207,255,.95)";
        context.beginPath();
        context.arc(x, y, 1.9, 0, Math.PI * 2);
        context.fill();

        pulse.t += pulse.speed;
        if (pulse.t < 1) return true;
        if (pulse.lands) {
          nodes[pulse.to].heat = 1;
          rings.push({ x: b.x, y: b.y, age: 0 });
        }
        return false;
      });

      for (const node of nodes) {
        // A warm node gets a halo as well as a colour, so an arrival still reads at a glance in
        // peripheral vision rather than only on close inspection.
        if (node.heat > 0.02) {
          const glow = context.createRadialGradient(node.x, node.y, 0, node.x, node.y, 13);
          glow.addColorStop(0, `rgba(99,223,164,${node.heat * 0.4})`);
          glow.addColorStop(1, "rgba(99,223,164,0)");
          context.fillStyle = glow;
          context.beginPath();
          context.arc(node.x, node.y, 13, 0, Math.PI * 2);
          context.fill();
        }

        // Cooling is a blend from the resting lilac toward the warm green, so a node fades back to the
        // field instead of snapping.
        const h = node.heat;
        context.fillStyle = `rgba(${Math.round(186 - 87 * h)},${Math.round(178 + 45 * h)},${Math.round(255 - 91 * h)},${0.66 + 0.3 * h})`;
        context.beginPath();
        context.arc(node.x, node.y, node.r + h * 0.9, 0, Math.PI * 2);
        context.fill();

        if (still) continue;
        node.heat = Math.max(0, node.heat - COOL);
        node.x += node.vx;
        node.y += node.vy;
        // Bounce rather than wrap: a point vanishing at one edge and reappearing at the other reads as
        // a glitch rather than as movement.
        if (node.x < 0 || node.x > width) node.vx *= -1;
        if (node.y < 0 || node.y > height) node.vy *= -1;
      }

      if (still) return;
      tick += 1;
      if (tick % PULSE_EVERY === 0) launch();
      frame = requestAnimationFrame(draw);
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
