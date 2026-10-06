// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { useEffect, useRef } from "react";

/**
 * The portal's background: a faint starfield with the occasional shooting star.
 *
 * It carries the Overview's constellation out across the whole page, so the hero reads as a window onto
 * the same sky rather than a box on black. Stars twinkle out of step and drift upward very slowly; every
 * ten seconds or so a shooting star crosses on a shallow diagonal and fades.
 *
 * One canvas, drawn with requestAnimationFrame (which the browser pauses in a background tab), sized to
 * the screen at its pixel density. Decoration only: behind everything, never clickable, hidden from
 * screen readers. With reduced motion it draws one still frame of stars and nothing moves. In light mode
 * it draws nothing — stars on white read as dust.
 */

type Star = { x: number; y: number; r: number; base: number; speed: number; phase: number; tint: string };
type Meteor = { x: number; y: number; vx: number; vy: number; life: number; max: number };

const TINTS = ["255,255,255", "214,220,255", "196,186,255", "190,240,226"];

export default function AppBackground() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0, height = 0, dpr = 1, frame = 0, last = 0, nextMeteor = 0;
    let stars: Star[] = [];
    let meteors: Meteor[] = [];

    const seed = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round((width * height) / 7000);
      stars = Array.from({ length: count }, () => {
        const big = Math.random() < 0.08;
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          r: big ? 1.1 + Math.random() * 0.6 : 0.4 + Math.random() * 0.6,
          base: big ? 0.55 : 0.18 + Math.random() * 0.35,
          speed: 0.6 + Math.random() * 1.6,
          phase: Math.random() * Math.PI * 2,
          tint: TINTS[Math.floor(Math.random() * TINTS.length)],
        };
      });
    };

    const launch = () => {
      // From the top or right edge, heading down-left on a shallow diagonal.
      const fromTop = Math.random() < 0.6;
      const x = fromTop ? width * (0.35 + Math.random() * 0.65) : width + 20;
      const y = fromTop ? -20 : height * Math.random() * 0.45;
      const angle = (150 + Math.random() * 18) * (Math.PI / 180);
      const speed = 0.9 + Math.random() * 0.5; // px per ms
      meteors.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 0, max: 900 + Math.random() * 500 });
    };

    const draw = (time: number) => {
      const light = document.body.classList.contains("light-mode");
      const dt = last ? Math.min(64, time - last) : 16;
      last = time;
      ctx.clearRect(0, 0, width, height);
      if (!light) {
        const t = time / 1000;
        for (const star of stars) {
          if (!still) {
            star.y -= star.speed * dt * 0.0012;
            if (star.y < -2) { star.y = height + 2; star.x = Math.random() * width; }
          }
          const twinkle = still ? 1 : 0.65 + 0.35 * Math.sin(t * star.speed + star.phase);
          ctx.globalAlpha = star.base * twinkle;
          ctx.fillStyle = `rgb(${star.tint})`;
          ctx.beginPath();
          ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;

        if (!still) {
          if (!nextMeteor) nextMeteor = time + 2500;
          if (time > nextMeteor) { launch(); nextMeteor = time + 7000 + Math.random() * 7000; }
          meteors = meteors.filter((m) => m.life < m.max);
          for (const m of meteors) {
            m.life += dt;
            m.x += m.vx * dt;
            m.y += m.vy * dt;
            const fade = Math.sin(Math.PI * (m.life / m.max));
            const tail = 140;
            const len = Math.hypot(m.vx, m.vy);
            const tx = m.x - (m.vx / len) * tail, ty = m.y - (m.vy / len) * tail;
            const gradient = ctx.createLinearGradient(m.x, m.y, tx, ty);
            gradient.addColorStop(0, `rgba(255,255,255,${0.85 * fade})`);
            gradient.addColorStop(0.3, `rgba(190,180,255,${0.35 * fade})`);
            gradient.addColorStop(1, "rgba(190,180,255,0)");
            ctx.strokeStyle = gradient;
            ctx.lineWidth = 1.4;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(m.x, m.y);
            ctx.lineTo(tx, ty);
            ctx.stroke();
          }
        }
      }
      if (!still) frame = requestAnimationFrame(draw);
    };

    seed();
    // The first frame is drawn straight away, so the stars are there on load rather than a frame later.
    draw(performance.now());
    const onResize = () => { seed(); if (still) requestAnimationFrame(draw); };
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", onResize); };
  }, []);

  return <canvas ref={ref} className="app-bg" aria-hidden="true" />;
}
