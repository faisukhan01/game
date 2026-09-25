/**
 * VOIDSTRIKE — arena renderer (2.5D side view, "OLD TOWN PARK" theme).
 *
 * The sim is top-down; this module projects the floor plane with a fixed
 * camera pitch and draws a natural dusk arena: baked sky + derelict skyline,
 * park ground with roads and paths, themed abandoned cover (boundary walls,
 * restaurant, kiosk, guard cabin), swaying scenery and side-view soldier
 * rigs with rifles — all depth-sorted by their floor y. Canvas transform
 * (letterbox scale × DPR) is applied by the game loop; this module only
 * draws. Cover collision footprints are never altered here.
 */

import { OBSTACLES } from "@/lib/sim/constants";
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
import {
  DECOR,
  drawDecor,
  drawGround,
  drawSky,
  drawStructure,
} from "./environment";

/** Ambient scene clock (seconds) — drives sway, clouds and birds. */
let sceneT = 0;

interface Drawable {
  sortY: number;
  kind: "structure" | "decor" | "bot" | "player";
  structureIdx?: number;
  decorIdx?: number;
  botIdx?: number;
}

/**
 * `dtSec` is the clamped real-frame delta used only for cosmetic animation
 * (facing smoothing, gait, ambience) — never for simulation.
 */
export function renderGame(
  ctx: CanvasRenderingContext2D,
  world: World,
  fx: Effects,
  monoFont: string,
  dtSec: number,
): void {
  sceneT += dtSec;

  ctx.save();

  // Screenshake.
  ctx.translate(fx.shakeX, fx.shakeY);

  // Sky (baked dusk + drifting clouds + birds) and park ground.
  drawSky(ctx, sceneT);
  drawGround(ctx);

  // Dash afterimages — soft energy blooms flat on the ground, newest on top.
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

  // Nova / wave rings — shockwaves ripple across the ground.
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

  // ---- depth-sorted world: structures, scenery + operatives ----------------
  const pl = world.player;
  const items: Drawable[] = [];
  for (let i = 0; i < OBSTACLES.length; i++) {
    const b = OBSTACLES[i];
    items.push({ sortY: b.y + b.h, kind: "structure", structureIdx: i });
  }
  for (let i = 0; i < DECOR.length; i++) {
    items.push({ sortY: DECOR[i].y, kind: "decor", decorIdx: i });
  }
  for (let i = 0; i < world.bots.length; i++) {
    if (!world.bots[i].dead) items.push({ sortY: world.bots[i].y, kind: "bot", botIdx: i });
  }
  if (!pl.dead) items.push({ sortY: pl.y, kind: "player" });
  items.sort((p, q) => p.sortY - q.sortY);

  for (const it of items) {
    if (it.kind === "structure") {
      const b = OBSTACLES[it.structureIdx!];
      drawStructure(ctx, it.structureIdx!, b);
      // X-ray ghost: if the striker is hidden behind this structure, draw a
      // translucent silhouette over it so the player never loses themselves.
      if (
        !pl.dead &&
        pl.x >= b.x &&
        pl.x <= b.x + b.w &&
        pl.y >= b.y - 24 &&
        pl.y <= b.y + b.h
      ) {
        ctx.globalAlpha = 0.42;
        drawFighter(ctx, pl, pl.aimX, pl.aimY, PALETTE_PLAYER, dtSec, { isPlayer: true });
        ctx.globalAlpha = 1;
      }
      continue;
    }
    if (it.kind === "decor") {
      drawDecor(ctx, DECOR[it.decorIdx!], sceneT);
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
        ctx.fillStyle = "rgba(20,20,16,0.55)";
        ctx.fillRect(b.x - w / 2 - 1, barY - 1, w + 2, 5);
        ctx.fillStyle = "rgba(255,255,255,0.14)";
        ctx.fillRect(b.x - w / 2, barY, w, 3);
        ctx.fillStyle = "#FF3D5A";
        ctx.fillRect(b.x - w / 2, barY, w * frac, 3);
      }
      continue;
    }
    // Striker operative.
    const S = pl.radius * VISUAL_SCALE;
    // Dash-ready ring on the ground under the boots.
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

  // Particles — debris hovers just above the ground; grouped per color.
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
    ctx.strokeStyle = "rgba(24,22,16,0.9)";
    ctx.lineWidth = 3;
    const fy = groundY(f.y) - soldierChestLift(pl.radius) * 1.7;
    ctx.strokeText(f.text, f.x, fy);
    ctx.fillStyle = FX_COLORS[f.color];
    ctx.fillText(f.text, f.x, fy);
  }
  ctx.globalAlpha = 1;

  ctx.restore();
}
