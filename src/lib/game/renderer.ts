/**
 * VOIDSTRIKE — arena renderer. Reads sim state, draws the world in
 * 1600×900 coordinates. Canvas transform (letterbox scale × DPR) is applied
 * by the game loop; this module only draws. Canvas state changes are batched
 * by grouping draws per style.
 */

import { OBSTACLES, WORLD_H, WORLD_W } from "@/lib/sim/constants";
import type { World } from "@/lib/sim/world";
import { Effects, FX_COLORS } from "./effects";

const GRID = 24;

function strokeCornerTicks(ctx: CanvasRenderingContext2D): void {
  // 18px volt L-ticks on the arena corners — angular brand motif.
  const L = 18;
  ctx.strokeStyle = "rgba(200,243,29,0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, L); ctx.lineTo(0, 0); ctx.lineTo(L, 0);
  ctx.moveTo(WORLD_W - L, 0); ctx.lineTo(WORLD_W, 0); ctx.lineTo(WORLD_W, L);
  ctx.moveTo(WORLD_W, WORLD_H - L); ctx.lineTo(WORLD_W, WORLD_H); ctx.lineTo(WORLD_W - L, WORLD_H);
  ctx.moveTo(L, WORLD_H); ctx.lineTo(0, WORLD_H); ctx.lineTo(0, WORLD_H - L);
  ctx.stroke();
}

export function renderGame(
  ctx: CanvasRenderingContext2D,
  world: World,
  fx: Effects,
  monoFont: string,
): void {
  ctx.save();

  // Screenshake.
  ctx.translate(fx.shakeX, fx.shakeY);

  // Void background.
  ctx.fillStyle = "#07080A";
  ctx.fillRect(-40, -40, WORLD_W + 80, WORLD_H + 80);

  // 24px engineering grid.
  ctx.strokeStyle = "rgba(255,255,255,0.045)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = GRID; x < WORLD_W; x += GRID) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, WORLD_H);
  }
  for (let y = GRID; y < WORLD_H; y += GRID) {
    ctx.moveTo(0, y);
    ctx.lineTo(WORLD_W, y);
  }
  ctx.stroke();

  // Arena border.
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(0, 0, WORLD_W, WORLD_H);
  strokeCornerTicks(ctx);

  // Obstacles.
  ctx.fillStyle = "#0E1013";
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.beginPath();
  for (const b of OBSTACLES) ctx.rect(b.x, b.y, b.w, b.h);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "rgba(200,243,29,0.35)";
  ctx.beginPath();
  for (const b of OBSTACLES) {
    ctx.moveTo(b.x, b.y + 10);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(b.x + 10, b.y);
  }
  ctx.stroke();

  // Dash afterimages.
  for (const a of fx.afterimages) {
    if (a.life <= 0) continue;
    ctx.globalAlpha = (a.life / 0.28) * 0.30;
    ctx.fillStyle = "#C8F31D";
    ctx.beginPath();
    ctx.arc(a.x, a.y, 14, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Nova / wave rings.
  for (const r of fx.rings) {
    if (r.life <= 0) continue;
    ctx.globalAlpha = (r.life / r.maxLife) * 0.8;
    ctx.strokeStyle = FX_COLORS[r.color];
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Projectiles: trail line + core, grouped per team.
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#C8F31D";
  ctx.beginPath();
  for (const p of world.projectiles) {
    if (!p.active || p.team !== 0) continue;
    ctx.moveTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.strokeStyle = "#FF3D5A";
  ctx.beginPath();
  for (const p of world.projectiles) {
    if (!p.active || p.team !== 1) continue;
    ctx.moveTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();

  // Bots.
  for (const b of world.bots) {
    if (b.dead) continue;
    // Body.
    ctx.fillStyle = "rgba(255,61,90,0.16)";
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#FF3D5A";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Core.
    ctx.fillStyle = "#FF3D5A";
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius * 0.42, 0, Math.PI * 2);
    ctx.fill();
    // HP bar when damaged.
    if (b.hp < b.maxHp) {
      const w = 26;
      const frac = Math.max(0, b.hp / b.maxHp);
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.fillRect(b.x - w / 2, b.y - b.radius - 10, w, 3);
      ctx.fillStyle = "#FF3D5A";
      ctx.fillRect(b.x - w / 2, b.y - b.radius - 10, w * frac, 3);
    }
  }

  // Player (skip if dead — death burst covers it).
  const p = world.player;
  if (!p.dead) {
    // Dash-ready ring.
    ctx.globalAlpha = p.dashCd <= 0 ? 0.4 : 0.12;
    ctx.strokeStyle = "#C8F31D";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius + 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = "#C8F31D";
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#07080A";
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius * 0.45, 0, Math.PI * 2);
    ctx.fill();
    // Aim tick.
    ctx.strokeStyle = "#C8F31D";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(p.x + p.aimX * (p.radius + 3), p.y + p.aimY * (p.radius + 3));
    ctx.lineTo(p.x + p.aimX * (p.radius + 13), p.y + p.aimY * (p.radius + 13));
    ctx.stroke();
  }

  // Particles — grouped per color (batched state changes).
  for (let c = 0; c < FX_COLORS.length; c++) {
    ctx.fillStyle = FX_COLORS[c];
    let any = false;
    for (const pt of fx.particles) {
      if (pt.life <= 0 || pt.color !== c) continue;
      any = true;
      break;
    }
    if (!any) continue;
    ctx.beginPath();
    for (const pt of fx.particles) {
      if (pt.life <= 0 || pt.color !== c) continue;
      ctx.globalAlpha = Math.min(1, pt.life / pt.maxLife);
      const s = pt.size;
      ctx.rect(pt.x - s / 2, pt.y - s / 2, s, s);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Floating damage numbers.
  ctx.font = `700 13px ${monoFont}`;
  ctx.textAlign = "center";
  for (const f of fx.floaters) {
    if (f.life <= 0) continue;
    ctx.globalAlpha = Math.min(1, (f.life / f.maxLife) * 1.6);
    ctx.strokeStyle = "rgba(7,8,10,0.9)";
    ctx.lineWidth = 3;
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = FX_COLORS[f.color];
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;

  ctx.restore();
}
