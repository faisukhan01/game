/**
 * VOIDSTRIKE — arena renderer. Reads sim state, draws the world in
 * 1600×900 coordinates. Canvas transform (letterbox scale × DPR) is applied
 * by the game loop; this module only draws. Canvas state changes are batched
 * by grouping draws per style.
 */

import { OBSTACLES, WORLD_H, WORLD_W } from "@/lib/sim/constants";
import type { World } from "@/lib/sim/world";
import {
  drawFighter,
  drawMuzzleFlash,
  drawReticle,
  muzzleExtension,
  PALETTE_BOT,
  PALETTE_PLAYER,
  VISUAL_SCALE,
} from "./characters";
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

/**
 * `dtSec` is the clamped real-frame delta used only for cosmetic animation
 * (facing smoothing, gait) — never for simulation.
 */
export function renderGame(
  ctx: CanvasRenderingContext2D,
  world: World,
  fx: Effects,
  monoFont: string,
  dtSec: number,
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

  // Dash afterimages — soft energy blooms, newest on top.
  for (const a of fx.afterimages) {
    if (a.life <= 0) continue;
    const k = a.life / 0.28;
    ctx.globalAlpha = k * 0.34;
    ctx.fillStyle = "#C8F31D";
    ctx.beginPath();
    ctx.arc(a.x, a.y, 6 + 10 * (1 - k), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = k * 0.22;
    ctx.strokeStyle = "#C8F31D";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 13, 0, Math.PI * 2);
    ctx.stroke();
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

  // Hostile operatives.
  const pl = world.player;
  for (const b of world.bots) {
    if (b.dead) continue;
    // Intent heading: engage vector while attacking, else travel heading.
    let aimX = 0;
    let aimY = 0;
    if (b.state === "ATTACK" || b.state === "CHASE") {
      aimX = pl.x - b.x;
      aimY = pl.y - b.y;
    } else if (Math.hypot(b.vx, b.vy) > 1) {
      aimX = b.vx;
      aimY = b.vy;
    }
    drawFighter(ctx, b, aimX, aimY, PALETTE_BOT, dtSec, { isPlayer: false });
    // HP bar when damaged.
    if (b.hp < b.maxHp) {
      const w = 30;
      const frac = Math.max(0, b.hp / b.maxHp);
      const barY = b.y - b.radius * VISUAL_SCALE - 10;
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.fillRect(b.x - w / 2, barY, w, 3);
      ctx.fillStyle = "#FF3D5A";
      ctx.fillRect(b.x - w / 2, barY, w * frac, 3);
    }
  }

  // Striker operative (skip if dead — death burst covers it).
  if (!pl.dead) {
    // Dash-ready ring.
    ctx.globalAlpha = pl.dashCd <= 0 ? 0.4 : 0.12;
    ctx.strokeStyle = "#C8F31D";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(pl.x, pl.y, pl.radius * VISUAL_SCALE + 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    drawFighter(ctx, pl, pl.aimX, pl.aimY, PALETTE_PLAYER, dtSec, { isPlayer: true });
    drawReticle(ctx, pl.x, pl.y, pl.aimX, pl.aimY, pl.radius * VISUAL_SCALE + 32);
  }

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

  // Muzzle flashes sit right on top of the barrels (extended to the visual
  // muzzle — the sim spawns projectiles closer to the body than the gun tip).
  const ext = muzzleExtension(world.player.radius);
  for (const fl of fx.flashes) {
    if (fl.life <= 0) continue;
    drawMuzzleFlash(
      ctx,
      fl.x + fl.dx * ext,
      fl.y + fl.dy * ext,
      fl.dx,
      fl.dy,
      fl.team,
      fl.life / fl.maxLife,
    );
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
