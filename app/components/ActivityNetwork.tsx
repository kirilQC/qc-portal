// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

/**
 * Recent activity as a living network.
 *
 * ── What it is ──────────────────────────────────────────────────────────────────────────────────
 * The sign-in screen's constellation, made of the client's own outreach. The bright anchored nodes are
 * their senders; the small drifting ones are leads. When a reply lands, a pulse travels the line from a
 * sender to the lead and the lead node warms green and throws a ring — and the rail beside it names the
 * person, shows their photo, and quotes what they actually said, one click from the conversation.
 *
 * ── What is real and what is atmosphere ─────────────────────────────────────────────────────────
 * The events are real: each pulse corresponds to an actual reply in `events`, played in order, and the
 * rail shows that reply's person, quote and link. The *positions* are not — a node's place in the field
 * carries no meaning, exactly as on the login. The graphic is the product's subject (connections being
 * made) rather than a chart of it, and it is honest about which half is which: the numbers live in the
 * rail, the motion lives in the field.
 *
 * ── Motion discipline ───────────────────────────────────────────────────────────────────────────
 * `prefers-reduced-motion` draws a single still frame with a share of nodes pre-warmed, schedules no
 * pulses, and shows the newest event in the rail without cycling. The canvas is decorative and sits in
 * an `aria-hidden` layer; everything a screen reader needs is the real list in the rail.
 */

export type ActivityEvent = {
  kind: "reply" | "positive" | "launch" | "meeting";
  at: string;
  title: string;
  detail: string;
  name?: string;
  initials?: string;
  photoUrl?: string | null;
  where?: string;
  campaign?: string | null;
  sender?: string | null;
  quote?: string | null;
  conversationId?: string;
};

const KIND_LABEL: Record<ActivityEvent["kind"], string> = {
  positive: "replied positively",
  reply: "replied",
  launch: "launched",
  meeting: "meeting booked",
};

/** "2 days ago", "3 weeks ago" — the rail reads as ages, not timestamps. */
function ago(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then) || !now) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  const units: [number, string][] = [[86400, "d"], [3600, "h"], [60, "m"]];
  for (const [size, suffix] of units) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${suffix} ago`;
  }
  return "just now";
}

type Node = { x: number; y: number; vx: number; vy: number; r: number; heat: number; sender: boolean };
type Pulse = { from: Node; to: Node; t: number; speed: number; warm: boolean };
type Ring = { x: number; y: number; age: number };

const LEAD_COUNT = 40;
const LINK = 120;
const RING_LIFE = 42;

export default function ActivityNetwork({
  events,
  senders,
  clientSlug,
  variant = "full",
  children,
}: {
  events: ActivityEvent[];
  senders: string[];
  clientSlug: string | null;
  /** "full" = scene + rail (default). "hero" = the animated scene alone, with `children` overlaid. "feed" = the rail alone. */
  variant?: "full" | "hero" | "feed";
  children?: React.ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // The rail follows the field: a pulse landing is what advances the shown event, so the two never drift.
  const [shownIndex, setShownIndex] = useState(0);
  const [now, setNow] = useState(0);
  // Stamped on mount rather than during render, so the server and the first client paint agree on a
  // value and the relative times ("2h ago") are computed against the client's real clock afterwards.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setNow(Date.now()), []);

  // Only replies get a pulse and a place in the cycle; launches and meetings sit in the "also" strip.
  const replies = useMemo(() => events.filter((event) => event.kind === "positive" || event.kind === "reply"), [events]);
  const senderCount = Math.min(Math.max(senders.length, 3), 6);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let frame = 0;
    let tick = 0;
    let cursor = 0;
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
      const senderNodes: Node[] = Array.from({ length: senderCount }, () => ({
        x: Math.random() * width, y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.12, vy: (Math.random() - 0.5) * 0.12,
        r: 3.2, heat: 0, sender: true,
      }));
      const leadNodes: Node[] = Array.from({ length: LEAD_COUNT }, () => ({
        x: Math.random() * width, y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.22, vy: (Math.random() - 0.5) * 0.22,
        r: Math.random() * 1.4 + 0.9,
        // In the still frame, pre-warm a few so the composition reads without any motion.
        heat: still && Math.random() < 0.14 ? 1 : 0, sender: false,
      }));
      nodes = [...senderNodes, ...leadNodes];
      pulses = [];
      rings = [];
    }

    /**
     * Launch a pulse for the next real reply, and advance the rail to match.
     *
     * `advanceRail` is false on the very first call, which happens synchronously while the effect is
     * setting up — calling setState there triggers React's cascading-render warning, and the rail
     * already starts on index 0, so there is nothing to set. Every later call (a real timer tick) does
     * advance it.
     */
    function fire(advanceRail = true) {
      // A pulse still represents a reply travelling the network (a launch or a meeting is not a signal moving
      // between two people), but the rail cycles through EVERY kind of event so launches and meetings fire in too.
      if (replies.length) {
        const event = replies[cursor % replies.length];
        const senderPool = nodes.filter((node) => node.sender);
        const from = senderPool[Math.floor(Math.random() * senderPool.length)] ?? nodes[0];
        const leadPool = nodes.filter((node) => !node.sender);
        const to = leadPool[Math.floor(Math.random() * leadPool.length)] ?? nodes[nodes.length - 1];
        pulses.push({ from, to, t: 0, speed: 0.02 + Math.random() * 0.01, warm: event.kind === "positive" });
      }
      if (advanceRail && events.length) setShownIndex(cursor % events.length);
      cursor += 1;
    }

    function draw() {
      if (!context) return;
      context.clearRect(0, 0, width, height);

      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const distance = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
          if (distance > LINK) continue;
          context.strokeStyle = `rgba(139,124,255,${(1 - distance / LINK) * 0.24})`;
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(nodes[i].x, nodes[i].y);
          context.lineTo(nodes[j].x, nodes[j].y);
          context.stroke();
        }
      }

      rings = rings.filter((ring) => {
        const life = ring.age / RING_LIFE;
        context.strokeStyle = `rgba(99,223,164,${(1 - life) * 0.5})`;
        context.lineWidth = 1.2;
        context.beginPath();
        context.arc(ring.x, ring.y, 3 + life * 22, 0, Math.PI * 2);
        context.stroke();
        ring.age += still ? 0 : 1;
        return ring.age < RING_LIFE;
      });

      pulses = pulses.filter((pulse) => {
        const x = pulse.from.x + (pulse.to.x - pulse.from.x) * pulse.t;
        const y = pulse.from.y + (pulse.to.y - pulse.from.y) * pulse.t;
        const trail = Math.max(0, pulse.t - 0.2);
        context.strokeStyle = pulse.warm ? "rgba(120,230,180,.6)" : "rgba(167,152,255,.55)";
        context.lineWidth = 1.5;
        context.beginPath();
        context.moveTo(pulse.from.x + (pulse.to.x - pulse.from.x) * trail, pulse.from.y + (pulse.to.y - pulse.from.y) * trail);
        context.lineTo(x, y);
        context.stroke();
        context.fillStyle = "rgba(220,230,255,.95)";
        context.beginPath();
        context.arc(x, y, 2, 0, Math.PI * 2);
        context.fill();
        pulse.t += still ? 1 : pulse.speed;
        if (pulse.t < 1) return true;
        if (pulse.warm) {
          pulse.to.heat = 1;
          rings.push({ x: pulse.to.x, y: pulse.to.y, age: 0 });
        } else {
          pulse.to.heat = Math.max(pulse.to.heat, 0.5);
        }
        return false;
      });

      for (const node of nodes) {
        if (node.heat > 0.02) {
          const glow = context.createRadialGradient(node.x, node.y, 0, node.x, node.y, 12);
          glow.addColorStop(0, `rgba(99,223,164,${node.heat * 0.42})`);
          glow.addColorStop(1, "rgba(99,223,164,0)");
          context.fillStyle = glow;
          context.beginPath();
          context.arc(node.x, node.y, 12, 0, Math.PI * 2);
          context.fill();
        }
        const h = node.heat;
        context.fillStyle = node.sender
          ? "rgba(139,124,255,.95)"
          : `rgba(${Math.round(186 - 87 * h)},${Math.round(178 + 45 * h)},${Math.round(255 - 91 * h)},${0.6 + 0.3 * h})`;
        context.beginPath();
        context.arc(node.x, node.y, node.r + h * 0.8, 0, Math.PI * 2);
        context.fill();

        if (still) continue;
        node.heat = Math.max(0, node.heat - 0.006);
        node.x += node.vx;
        node.y += node.vy;
        if (node.x < 0 || node.x > width) node.vx *= -1;
        if (node.y < 0 || node.y > height) node.vy *= -1;
      }

      if (still) return;
      tick += 1;
      // ~3.6s between arrivals: often enough to feel alive, calm enough to live beside on a daily page.
      if (tick % 216 === 0) fire();
      frame = requestAnimationFrame(draw);
    }

    seed();
    fire(false);
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
    // Re-seeding on every render would restart the drift; it only depends on the event/reply set and senders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replies.length, events.length, senderCount]);

  const shown = events.length ? events[shownIndex % events.length] : null;
  // The list below the main card is recent people who replied — all replies, not only positive.
  const others = events.filter((event) => (event.kind === "positive" || event.kind === "reply") && event !== shown).slice(0, 4);

  const scene = (
    <div className="ov-net-scene">
      <canvas ref={canvasRef} className="ov-net-canvas" aria-hidden="true" />
      <div className="ov-net-legend" aria-hidden="true">
        <span><i className="d-sender" />Sender</span>
        <span><i className="d-lead" />Lead</span>
        <span><i className="d-warm" />Replied</span>
      </div>
    </div>
  );

  const rail = (
    <div className="ov-net-rail">
      <span className="ov-net-lbl">Just in</span>
      {shown ? (
        <RailCard event={shown} now={now} clientSlug={clientSlug} />
      ) : (
        <p className="empty">No replies yet this week.</p>
      )}

      {others.length > 0 && (
        <div className="ov-net-also">
          {others.map((event, index) => (
            <div className="ov-net-alsorow" key={`${event.at}-${index}`}>
              <FeedAvatar photoUrl={event.photoUrl} initials={event.initials} warm={event.kind === "positive"} small />
              <span className="ov-net-alsoname">{event.name}</span>
              <time>{ago(event.at, now)}</time>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // Hero: the animated scene fills the whole box; the week's summary sits over it bottom-left, and the live
  // "Just in" feed sits over it on the right — so a shooting star landing and the reply it represents are
  // in the same frame.
  if (variant === "hero") {
    return (
      <section className="ov-hero-net">
        {scene}
        <aside className="ov-hero-feed">
          <span className="ov-net-live ov-hero-feed-live" aria-hidden="true"><i />live</span>
          {rail}
        </aside>
        {children && <div className="ov-hero-copy">{children}</div>}
      </section>
    );
  }

  // Feed: the "Just in" rail alone, in a panel of its own.
  if (variant === "feed") {
    return (
      <section className="panel ov-net-panel ov-net-feedonly">
        <div className="panel-head"><h2>Recent activity</h2><span className="ov-net-live" aria-hidden="true"><i />live</span></div>
        {rail}
      </section>
    );
  }

  return (
    <section className="panel ov-net-panel">
      <div className="panel-head">
        <h2>Recent activity</h2>
        <span className="ov-net-live" aria-hidden="true"><i />live</span>
      </div>
      <div className="ov-net">{scene}{rail}</div>
    </section>
  );
}

const KIND_ICON: Record<ActivityEvent["kind"], string> = { positive: "", reply: "", launch: "🚀", meeting: "📅" };

/** A feed avatar that falls back to initials when the LinkedIn photo is broken or expired. */
function FeedAvatar({ photoUrl, initials, warm, small }: { photoUrl?: string | null; initials?: string; warm: boolean; small?: boolean }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`ov-net-av ${warm ? "is-warm" : ""} ${small ? "ov-net-av-sm" : ""}`}>
      {photoUrl && !broken ? <img src={photoUrl} alt="" onError={() => setBroken(true)} /> : (initials || "?")}
    </span>
  );
}

/** One event — a reply (face + words + a way into the inbox) or a launch / booked meeting (icon + headline). */
function RailCard({ event, now, clientSlug }: { event: ActivityEvent; now: number; clientSlug: string | null }) {
  const isReply = event.kind === "positive" || event.kind === "reply";
  const href = event.conversationId
    ? `${clientSlug ? `/${clientSlug}` : ""}/inbox?conversation=${encodeURIComponent(event.conversationId)}`
    : `${clientSlug ? `/${clientSlug}` : ""}/inbox`;

  const inner = isReply ? (
    <>
      <FeedAvatar photoUrl={event.photoUrl} initials={event.initials} warm={event.kind === "positive"} />
      <span className="ov-net-body">
        <span className="ov-net-name">{event.name}<em> {KIND_LABEL[event.kind]}</em></span>
        {event.where && <span className="ov-net-where">{event.where}{event.campaign ? ` · ${event.campaign}` : ""}</span>}
        {event.quote && <span className="ov-net-quote">“{event.quote}”</span>}
        <span className="ov-net-foot">
          <time>{ago(event.at, now)}</time>
          {event.conversationId && <span className="ov-net-go">Open conversation →</span>}
        </span>
      </span>
    </>
  ) : (
    <>
      <span className={`ov-net-ic is-${event.kind}`}>{KIND_ICON[event.kind]}</span>
      <span className="ov-net-body">
        <span className="ov-net-name">{event.title}</span>
        {event.detail && <span className="ov-net-where">{event.detail}</span>}
        <span className="ov-net-foot"><time>{ago(event.at, now)}</time></span>
      </span>
    </>
  );

  return isReply && event.conversationId
    ? <Link className="ov-net-card is-link" href={href}>{inner}</Link>
    : <div className="ov-net-card">{inner}</div>;
}
