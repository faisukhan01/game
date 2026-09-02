"use client";

/**
 * Home backdrop: engineering grid, drifting particles on canvas, and a
 * 4%-opacity scanline overlay. Honors prefers-reduced-motion (static render).
 */

import { useEffect, useRef } from "react";

interface Drifter {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  volt: boolean;
}

export function Backdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let raf = 0;
    let w = 0;
    let h = 0;
    const drifters: Drifter[] = [];

    const seedField = () => {
      drifters.length = 0;
      const count = Math.min(90, Math.floor((w * h) / 26000));
      for (let i = 0; i < count; i++) {
        drifters.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 14,
          vy: (Math.random() - 0.5) * 10,
          size: Math.random() < 0.85 ? 1.5 : 2.5,
          alpha: 0.06 + Math.random() * 0.16,
          volt: Math.random() < 0.18,
        });
      }
    };

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seedField();
      if (reduced) draw();
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const d of drifters) {
        ctx.globalAlpha = d.alpha;
        ctx.fillStyle = d.volt ? "#C8F31D" : "#E8ECEF";
        ctx.fillRect(d.x, d.y, d.size, d.size);
      }
      ctx.globalAlpha = 1;
    };

    const step = (t: number, last: number) => {
      const dt = Math.min((t - last) / 1000, 0.05);
      for (const d of drifters) {
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        if (d.x < -4) d.x = w + 4;
        else if (d.x > w + 4) d.x = -4;
        if (d.y < -4) d.y = h + 4;
        else if (d.y > h + 4) d.y = -4;
      }
      draw();
      return t;
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(document.documentElement);

    if (!reduced) {
      let last = performance.now();
      const loop = (t: number) => {
        last = step(t, last);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      <div className="absolute inset-0 bg-void" />
      <div className="absolute inset-0 bg-grid-24" />
      <canvas ref={canvasRef} className="absolute inset-0" />
      <div className="scanlines absolute inset-0" />
      {/* Vignette edges to focus the hero */}
      <div className="absolute inset-0 shadow-[inset_0_0_180px_rgba(7,8,10,0.9)]" />
    </div>
  );
}
