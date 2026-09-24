/**
 * VOIDSTRIKE — geometry helpers (PROTOCOL.md §7).
 * Clamp-based segment/AABB test — no trigonometry, per protocol.
 */

import type { AABB } from "./constants";

/**
 * Liang–Barsky clip test: does segment (x0,y0)→(x1,y1) intersect the AABB?
 * Only multiplications/divisions and comparisons — no trig.
 */
export function segmentIntersectsAABB(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  b: AABB,
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let t0 = 0;
  let t1 = 1;

  const p0 = -dx;
  const p1 = dx;
  const p2 = -dy;
  const p3 = dy;
  const q0 = x0 - b.x;
  const q1 = b.x + b.w - x0;
  const q2 = y0 - b.y;
  const q3 = b.y + b.h - y0;

  const p = [p0, p1, p2, p3];
  const q = [q0, q1, q2, q3];

  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return true;
}

/** Nearest obstacle corner to (x, y) across all boxes — FLEE target (§7). */
export function nearestObstacleCorner(
  x: number,
  y: number,
  boxes: readonly AABB[],
): { x: number; y: number } {
  let bestX = x;
  let bestY = y;
  let bestD2 = Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const corners: readonly [number, number][] = [
      [b.x, b.y],
      [b.x + b.w, b.y],
      [b.x, b.y + b.h],
      [b.x + b.w, b.y + b.h],
    ];
    for (let c = 0; c < 4; c++) {
      const dx = corners[c][0] - x;
      const dy = corners[c][1] - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestX = corners[c][0];
        bestY = corners[c][1];
      }
    }
  }
  return { x: bestX, y: bestY };
}
