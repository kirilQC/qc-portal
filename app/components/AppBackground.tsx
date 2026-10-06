// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { useEffect, useState } from "react";

/**
 * The portal's background: a faint dot grid with slow ripples of light washing across it.
 *
 * Every few seconds a ring opens somewhere on the page and lights the dots it passes over, in the
 * client's accent colour or a soft violet, then fades. The lit dots are a second copy of the grid shown
 * only through the ring, offset so they sit exactly on top of the faint ones rather than beside them.
 *
 * It is decoration and behaves like it: behind everything, never clickable, hidden from screen readers,
 * paused while the tab is in the background, and reduced to the still grid for anyone who has asked their
 * system for less motion.
 */

const GRID = 18;
const SIZE = 1400; // the ripple's box; the visible ring is a band inside it
const LIFE = 7200;

type Ripple = { id: number; x: number; y: number; violet: boolean };

export default function AppBackground() {
  const [ripples, setRipples] = useState<Ripple[]>([]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let id = 0;
    let timer = 0;
    const timers = new Set<number>();
    const spawn = () => {
      if (document.visibilityState === "visible") {
        const ripple = {
          id: ++id,
          x: Math.round(window.innerWidth * (0.15 + Math.random() * 0.75)),
          y: Math.round(window.innerHeight * (0.1 + Math.random() * 0.8)),
          violet: id % 2 === 0,
        };
        setRipples((was) => [...was.slice(-2), ripple]);
        const done = window.setTimeout(() => {
          setRipples((was) => was.filter((r) => r.id !== ripple.id));
          timers.delete(done);
        }, LIFE);
        timers.add(done);
      }
      timer = window.setTimeout(spawn, 5000 + Math.random() * 4000);
    };
    timer = window.setTimeout(spawn, 1200);
    return () => {
      window.clearTimeout(timer);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const align = (n: number) => `${(((SIZE / 2 - n) % GRID) + GRID) % GRID}px`;

  return (
    <div className="app-bg" aria-hidden="true">
      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          className={`app-bg-ripple ${ripple.violet ? "is-violet" : ""}`}
          style={{
            left: ripple.x - SIZE / 2,
            top: ripple.y - SIZE / 2,
            backgroundPosition: `${align(ripple.x)} ${align(ripple.y)}`,
          }}
        />
      ))}
    </div>
  );
}
