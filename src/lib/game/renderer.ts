/**
 * VOIDSTRIKE — arena renderer (2.5D side view).
 *
 * The sim is top-down; this module projects the floor plane with a fixed
 * camera pitch and draws an upright billboard world: perspective grid,
 * extruded cover boxes, and side-view soldier rigs with rifles, all
 * depth-sorted by their floor y. Canvas transform (letterbox scale × DPR)
 * is applied by the game loop; this module only draws.
 */

import { OBSTACLES, WORLD_H, WORLD_W } from "@/lib/sim/constants";
import type { AABB } from "@/lib/sim/types";
import type { World } from "@/lib/sim/world";
import {
  drawFighter,
  drawMuzzleFlash,
  drawReticle,
  groundY,
  muzzleExtension,
  PALETTE_BOT,
  PALETTE_PLAYER,
  soldierChestLift,
  TILT,
  VISUAL_SCALE,
} from "./characters";
import { Effects, FX_COLORS } from "./effects";

const GRID = 24;
/** Tilted floor rectangle in screen space. */
const FLOOR_Y = 238; // groundY(0)
const FLOOR_H = WORLD_H * TILT;

function strokeCornerTicks(ctx: CanvasRenderingContext2D): void {
  // 18px volt L-ticks on the arena corners — angular brand motif.
  const L = 18;
  ctx.strokeStyle = "rgba(200,243,29,0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, FLOOR_Y + L); ctx.lineTo(0, FLOOR_Y); ctx.lineTo(L, FLOOR_Y);
  ctx.moveTo(WORLD_W - L, FLOOR_Y); ctx.lineTo(WORLD_W, FLOOR_Y); ctx.lineTo(WORLD_W, FLOOR_Y + L);
  ctx.moveTo(WORLD_W, FLOOR_Y + FLOOR_H - L); ctx.lineTo(WORLD_W, FLOOR_Y + FLOOR_H); ctx.lineTo(WORLD_W - L, FLOOR_Y + FLOOR_H);
  ctx.moveTo(L, FLOOR_Y + FLOOR_H); ctx.lineTo(0, FLOOR_Y + FLOOR_H); ctx.lineTo(0, FLOOR_Y + FLOOR_H - L);
  ctx.stroke();
}

/** Extruded cover box: footprint rect lifted by its world height. */
function drawBox(ctx: CanvasRenderingContext2D, b: AABB): void {
  const H = b.h * 1.32;
  const yFar = groundY(b.y);
  const yNear = groundY(b.y + b.h);
  // Front face.
  const grad = ctx.createLinearGradient(0, yNear - H, 0, yNear);
  grad.addColorStop(0, "#151920");
  grad.addColorStop(1, "#0A0C10");
  ctx.fillStyle = grad;
  ctx.fillRect(b.x, yNear - H, b.w, H);
  // Top face.
  ctx.fillStyle = "#1B2028";
  ctx.fillRect(b.x, yFar - H, b.w, yNear - yFar);
  // Silhouette + deck edge.
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1.4;
  ctx.strokeRect(b.x, yFar - H, b.w, yNear - yFar + H);
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath();
  ctx.moveTo(b.x, yNear - H);
  ctx.lineTo(b.x + b.w, yNear - H);
  ctx.stroke();
  // Volt corner ticks on the deck.
  ctx.strokeStyle = "rgba(200,243,29,0.5)";
  ctx.lineWidth = 1.6;
  const t = 9;
  ctx.beginPath();
  ctx.moveTo(b.x, yFar - H + t); ctx.lineTo(b.x, yFar - H); ctx.lineTo(b.x + t, yFar - H);
  ctx.moveTo(b.x + b.w - t, yFar - H); ctx.lineTo(b.x + b.w, yFar - H); ctx.lineTo(b.x + b.w, yFar - H + t);
  ctx.stroke();
}

interface Drawable {
  sortY: number;
  kind: "box" | "bot" | "player";
  box?: AABB;
  botIdx?: number;
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

  // Void backdrop above the horizon.
  ctx.fillStyle = "#07080A";
  ctx.fillRect(-40, -40, WORLD_W + 80, FLOOR_Y + 41);
  const sky = ctx.createLinearGradient(0, FLOOR_Y - 190, 0, FLOOR_Y);
  sky.addColorStop(0, "rgba(200,243,29,0)");
  sky.addColorStop(1, "rgba(200,243,29,0.05)");
  ctx.fillStyle = sky;
  ctx.fillRect(0, FLOOR_Y - 190, WORLD_W, 190);

  // Tilted floor deck.
  ctx.fillStyle = "#0B0D10";
  ctx.fillRect(0, FLOOR_Y, WORLD_W, FLOOR_H);

  // Perspective grid — verticals + depth-squashed horizontals.
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = GRID; x < WORLD_W; x += GRID) {
    ctx.moveTo(x, FLOOR_Y);
    ctx.lineTo(x, FLOOR_Y + FLOOR_H);
  }
  for (let y = GRID; y < WORLD_H; y += GRID) {
    const gy = groundY(y);
    ctx.moveTo(0, gy);
    ctx.lineTo(WORLD_W, gy);
  }
  ctx.stroke();

  // Horizon light strip.
  ctx.strokeStyle = "rgba(200,243,29,0.16)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, FLOOR_Y);
  ctx.lineTo(WORLD_W, FLOOR_Y);
  ctx.stroke();

  // Arena border + corner ticks.
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(0, FLOOR_Y, WORLD_W, FLOOR_H);
  strokeCornerTicks(ctx);

  // Dash afterimages — soft energy blooms flat on the deck, newest on top.
  for (const a of fx.afterimages) {
    if (a.life <= 0) continue;
    const k = a.life / 0.28;
    ctx.globalAlpha = k * 0.34;
    ctx.fillStyle = "#C8F31D";
    ctx.beginPath();
    ctx.ellipse(a.x, groundY(a.y), 8 + 12 * (1 - k), (8 + 12 * (1 - k)) * TILT, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Nova / wave rings — shockwaves ripple across the deck.
  for (const r of fx.rings) {
    if (r.life <= 0) continue;
    ctx.globalAlpha = (r.life / r.maxLife) * 0.8;
    ctx.strokeStyle = FX_COLORS[r.color];
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(r.x, groundY(r.y), r.r, r.r * TILT, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // ---- depth-sorted world: cover boxes + operatives -----------------------
  const pl = world.player;
  const items: Drawable[] = [];
  for (const b of OBSTACLES) items.push({ sortY: b.y + b.h, kind: "box", box: b });
  for (let i = 0; i < world.bots.length; i++) {
    if (!world.bots[i].dead) items.push({ sortY: world.bots[i].y, kind: "bot", botIdx: i });
  }
  if (!pl.dead) items.push({ sortY: pl.y, kind: "player" });
  items.sort((p, q) => p.sortY - q.sortY);

  for (const it of items) {
    if (it.kind === "box" && it.box) {
      drawBox(ctx, it.box);
      continue;
    }
    if (it.kind === "bot") {
      const b = world.bots[it.botIdx!];
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
      // HP bar floats above the helmet.
      if (b.hp < b.maxHp) {
        const S = b.radius * VISUAL_SCALE;
        const w = 30;
        const frac = Math.max(0, b.hp / b.maxHp);
        const barY = groundY(b.y) - S * 2.06;
        ctx.fillStyle = "rgba(255,255,255,0.10)";
        ctx.fillRect(b.x - w / 2, barY, w, 3);
        ctx.fillStyle = "#FF3D5A";
        ctx.fillRect(b.x - w / 2, barY, w * frac, 3);
      }
      continue;
    }
    // Striker operative.
    const S = pl.radius * VISUAL_SCALE;
    // Dash-ready ring on the deck under the boots.
    ctx.globalAlpha = pl.dashCd <= 0 ? 0.4 : 0.12;
    ctx.strokeStyle = "#C8F31D";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(pl.x, groundY(pl.y) + S * 0.06, S * 0.78, S * 0.3, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    drawFighter(ctx, pl, pl.aimX, pl.aimY, PALETTE_PLAYER, dtSec, { isPlayer: true });
    const chest = groundY(pl.y) - soldierChestLift(pl.radius);
    drawReticle(ctx, pl.x, chest, pl.aimX, pl.aimY, pl.radius * VISUAL_SCALE + 32);
  }

  // Projectiles: tracers flying at chest height, grouped per team.
  const chestAll = soldierChestLift(pl.radius) * 0.92;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#C8F31D";
  ctx.beginPath();
  for (const p of world.projectiles) {
    if (!p.active || p.team !== 0) continue;
    ctx.moveTo(p.x - p.vx * 0.03, groundY(p.y - p.vy * 0.03) - chestAll);
    ctx.lineTo(p.x, groundY(p.y) - chestAll);
  }
  ctx.stroke();
  ctx.strokeStyle = "#FF3D5A";
  ctx.beginPath();
  for (const p of world.projectiles) {
    if (!p.active || p.team !== 1) continue;
    ctx.moveTo(p.x - p.vx * 0.03, groundY(p.y - p.vy * 0.03) - chestAll);
    ctx.lineTo(p.x, groundY(p.y) - chestAll);
  }
  ctx.stroke();

  // Muzzle flashes sit right on the barrels (extended to the visual muzzle —
  // the sim spawns projectiles closer to the body than the gun tip).
  const ext = muzzleExtension(world.player.radius);
  for (const fl of fx.flashes) {
    if (fl.life <= 0) continue;
    const dl = Math.hypot(fl.dx, fl.dy * TILT) || 1;
    drawMuzzleFlash(
      ctx,
      fl.x + (fl.dx / dl) * ext,
      groundY(fl.y) - chestAll + (fl.dy * TILT / dl) * ext,
      fl.dx,
      fl.dy * TILT,
      fl.team,
      fl.life / fl.maxLife,
    );
  }

  // Particles — debris hovers just above the deck; grouped per color.
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
      ctx.rect(pt.x - s / 2, groundY(pt.y) - chestAll * 0.75 - s / 2, s, s);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Floating damage numbers above the helmets.
  ctx.font = `700 13px ${monoFont}`;
  ctx.textAlign = "center";
  for (const f of fx.floaters) {
    if (f.life <= 0) continue;
    ctx.globalAlpha = Math.min(1, (f.life / f.maxLife) * 1.6);
    ctx.strokeStyle = "rgba(7,8,10,0.9)";
    ctx.lineWidth = 3;
    const fy = groundY(f.y) - soldierChestLift(pl.radius) * 1.7;
    ctx.strokeText(f.text, f.x, fy);
    ctx.fillStyle = FX_COLORS[f.color];
    ctx.fillText(f.text, f.x, fy);
  }
  ctx.globalAlpha = 1;

  ctx.restore();
}
