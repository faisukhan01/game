/**
 * VOIDSTRIKE — minimap renderer (140×80 HUD panel).
 */

import { OBSTACLES, WORLD_H, WORLD_W } from "@/lib/sim/constants";
import type { World } from "@/lib/sim/world";

export const MINIMAP_W = 140;
export const MINIMAP_H = 80;

export function drawMinimap(ctx: CanvasRenderingContext2D, world: World): void {
  const pad = 5;
  const s = Math.min((MINIMAP_W - pad * 2) / WORLD_W, (MINIMAP_H - pad * 2) / WORLD_H);
  const ox = (MINIMAP_W - WORLD_W * s) / 2;
  const oy = (MINIMAP_H - WORLD_H * s) / 2;

  ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);
  ctx.fillStyle = "#0A0C0E";
  ctx.fillRect(0, 0, MINIMAP_W, MINIMAP_H);

  // Obstacles — hairline rects.
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const b of OBSTACLES) {
    ctx.rect(ox + b.x * s, oy + b.y * s, b.w * s, b.h * s);
  }
  ctx.stroke();

  // Bots — flare dots.
  ctx.fillStyle = "#FF3D5A";
  for (const b of world.bots) {
    if (b.dead) continue;
    ctx.fillRect(ox + b.x * s - 1.5, oy + b.y * s - 1.5, 3, 3);
  }

  // Player — volt dot + heading tick.
  const p = world.player;
  const px = ox + p.x * s;
  const py = oy + p.y * s;
  ctx.fillStyle = "#C8F31D";
  ctx.fillRect(px - 2, py - 2, 4, 4);
  ctx.strokeStyle = "rgba(200,243,29,0.5)";
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px + p.aimX * 7, py + p.aimY * 7);
  ctx.stroke();
}
