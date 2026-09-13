/**
 * VOIDSTRIKE — procedural soldier characters.
 *
 * Draws top-down humanoid operatives (boots, torso armor, shoulder plates,
 * helmet + visor, two-handed rifle rig) for the player and every hostile.
 * Purely cosmetic render-layer code: the deterministic sim is never touched.
 *
 * Animation state (gait phase, smoothed facing, per-bot shot tracking) lives
 * in a WeakMap keyed by the sim entities themselves — no allocation per
 * frame, no cleanup needed, zero coupling back into World.
 */

import type { Fighter } from "@/lib/sim/types";
import type { World } from "@/lib/sim/world";

export interface SoldierPalette {
  /** Armor base. */
  armor: string;
  /** Armor shading / outline. */
  armorDark: string;
  /** Armor top-light (chest plate, helmet rim). */
  armorLight: string;
  /** Helmet shell. */
  helmet: string;
  /** Visor glow. */
  visor: string;
  /** Boots + gloves. */
  gear: string;
  /** Rifle receiver. */
  gun: string;
  /** Rifle furniture (stock, grip, mag). */
  gunDark: string;
}

export const PALETTE_PLAYER: SoldierPalette = {
  armor: "#C8F31D",
  armorDark: "#7E9E14",
  armorLight: "#E9FF86",
  helmet: "#181B12",
  visor: "#F2FFCF",
  gear: "#343922",
  gun: "#3A4048",
  gunDark: "#20242A",
};

export const PALETTE_BOT: SoldierPalette = {
  armor: "#FF3D5A",
  armorDark: "#9E2440",
  armorLight: "#FF8DA1",
  helmet: "#1B1013",
  visor: "#FFC2CD",
  gear: "#3A1A22",
  gun: "#3A4048",
  gunDark: "#20242A",
};

/**
 * Soldiers are drawn well above their sim collision radius so the rig
 * (rifle, shoulder plates, boots) reads at arena scale.
 */
export const VISUAL_SCALE = 2.6;

/** Where the visual barrel tip sits, in world units from the fighter origin. */
export function visualMuzzle(radius: number): number {
  return radius * VISUAL_SCALE * 1.12;
}

/**
 * Distance from the sim projectile spawn point (radius + 6) to the visual
 * barrel tip — used to anchor muzzle flashes onto the gun.
 */
export function muzzleExtension(radius: number): number {
  return Math.max(0, visualMuzzle(radius) - (radius + 6));
}

interface FighterAnim {
  /** Smoothed facing direction (unit-ish vector). */
  fx: number;
  fy: number;
  /** Last ticked position, for velocity + gait measurement. */
  lx: number;
  ly: number;
  /** Distance traveled, drives leg phase. */
  gait: number;
  /** 0..1 blend of leg stride amplitude (eases out when standing). */
  stride: number;
  /** Seconds since this fighter last fired (bots use it to snap facing). */
  sinceShot: number;
  /** Direction of the last shot fired. */
  shotDx: number;
  shotDy: number;
  /** Whether the facing vector has been seeded. */
  seeded: boolean;
}

const anims = new WeakMap<object, FighterAnim>();

function animFor(f: Fighter): FighterAnim {
  let a = anims.get(f);
  if (!a) {
    a = {
      fx: 1,
      fy: 0,
      lx: f.x,
      ly: f.y,
      gait: 0,
      stride: 0,
      sinceShot: 9,
      shotDx: 1,
      shotDy: 0,
      seeded: false,
    };
    anims.set(f, a);
  }
  return a;
}

/** Shortest-arc angular approach toward (tx, ty). */
function steer(a: FighterAnim, tx: number, ty: number, dt: number, k: number): void {
  const tl = Math.hypot(tx, ty);
  if (tl < 1e-5) return;
  tx /= tl;
  ty /= tl;
  if (!a.seeded) {
    a.fx = tx;
    a.fy = ty;
    a.seeded = true;
    return;
  }
  const cur = Math.atan2(a.fy, a.fx);
  const tgt = Math.atan2(ty, tx);
  let d = tgt - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const na = cur + d * (1 - Math.exp(-k * dt));
  a.fx = Math.cos(na);
  a.fy = Math.sin(na);
}

/** Record a fighter's shot so its rifle snaps toward the target for a moment. */
export function noteFighterShot(world: World, x: number, y: number, dx: number, dy: number): void {
  let best: Fighter | null = null;
  let bestD = Infinity;
  for (const b of world.bots) {
    if (b.dead) continue;
    const d = Math.hypot(b.x - x, b.y - y);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  const p = world.player;
  const dp = Math.hypot(p.x - x, p.y - y);
  if (dp < bestD) {
    bestD = dp;
    best = p;
  }
  if (best && bestD < best.radius * VISUAL_SCALE * 1.5) {
    const a = animFor(best);
    a.sinceShot = 0;
    a.shotDx = dx;
    a.shotDy = dy;
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function capsule(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  w: number,
): void {
  ctx.lineWidth = w;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

export interface FighterDrawOpts {
  /** True for the striker — facing snaps hard onto the reticle. */
  isPlayer: boolean;
}

/**
 * Update + draw one operative. `aimX/aimY` is the intent direction (player
 * reticle or bot attack heading); facing is smoothed per frame.
 * `dt` is the real frame delta (seconds, clamped by the caller).
 */
export function drawFighter(
  ctx: CanvasRenderingContext2D,
  f: Fighter,
  aimX: number,
  aimY: number,
  palette: SoldierPalette,
  dt: number,
  opts: FighterDrawOpts,
): void {
  const a = animFor(f);
  const volt = opts.isPlayer || palette === PALETTE_PLAYER;

  // --- motion measurement -------------------------------------------------
  const dx = f.x - a.lx;
  const dy = f.y - a.ly;
  const dist = Math.hypot(dx, dy);
  a.lx = f.x;
  a.ly = f.y;
  if (dist > 0.05) a.gait += dist;
  const speedRef = Math.max(1, f.speed * dt);
  const moveAmt = Math.min(1, dist / speedRef);
  a.stride += (moveAmt - a.stride) * (1 - Math.exp(-14 * dt));

  // --- facing -------------------------------------------------------------
  a.sinceShot += dt;
  if (moveAmt > 0.08) {
    const last = Math.hypot(f.vx, f.vy);
    if (last > 1) steer(a, f.vx / last, f.vy / last, dt, 9);
  }
  if (a.sinceShot < 0.45) steer(a, a.shotDx, a.shotDy, dt, 16);
  steer(a, aimX, aimY, dt, opts.isPlayer ? 18 : 10);
  const ang = Math.atan2(a.fy, a.fx);

  const S = f.radius * VISUAL_SCALE;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  // Facing-frame helpers: FX(l,p) = forward l, side p (positive = right).
  const FX = (l: number, p: number) => f.x + c * l - s * p;
  const FY = (l: number, p: number) => f.y + s * l + c * p;

  // --- team glow + shadow -------------------------------------------------
  ctx.fillStyle = volt ? "rgba(200,243,29,0.09)" : "rgba(255,61,90,0.11)";
  ctx.beginPath();
  ctx.arc(f.x, f.y, S * 1.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.ellipse(f.x + 2, f.y + 3, S * 0.92, S * 0.55, ang, 0, Math.PI * 2);
  ctx.fill();

  // --- boots (walk cycle along the movement heading) -----------------------
  const phase = (a.gait / (S * 2.9)) * Math.PI * 2;
  const swing = S * 0.26 * a.stride;
  const wob = Math.sin(phase) * swing;
  const mvx = moveAmt > 0.08 ? dx / Math.max(dist, 1e-4) : c;
  const mvy = moveAmt > 0.08 ? dy / Math.max(dist, 1e-4) : s;
  const ma = Math.atan2(mvy, mvx);
  const mc = Math.cos(ma);
  const ms = Math.sin(ma);
  const legGap = S * 0.3;
  const legLen = S * 0.4;
  for (let i = 0; i < 2; i++) {
    const ph = i === 0 ? wob : -wob;
    const bx = f.x + mc * ph - ms * (i === 0 ? legGap : -legGap);
    const by = f.y + ms * ph + mc * (i === 0 ? -legGap : legGap);
    ctx.strokeStyle = palette.gear;
    capsule(
      ctx,
      bx - mc * legLen * 0.3,
      by - ms * legLen * 0.3,
      bx + mc * legLen * 0.36,
      by + ms * legLen * 0.36,
      S * 0.24,
    );
  }

  // --- rifle (under the arms, over the boots) ------------------------------
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.rotate(ang);
  // Stock.
  ctx.fillStyle = palette.gunDark;
  roundRect(ctx, -S * 0.24, -S * 0.085, S * 0.42, S * 0.17, S * 0.055);
  ctx.fill();
  // Receiver.
  ctx.fillStyle = palette.gun;
  roundRect(ctx, S * 0.16, -S * 0.105, S * 0.56, S * 0.21, S * 0.055);
  ctx.fill();
  // Energy cell — team-colored, keeps the rifle readable on the void.
  ctx.fillStyle = palette.armor;
  roundRect(ctx, S * 0.24, -S * 0.045, S * 0.3, S * 0.09, S * 0.03);
  ctx.fill();
  // Barrel.
  ctx.fillStyle = palette.gunDark;
  roundRect(ctx, S * 0.7, -S * 0.055, S * 0.44, S * 0.11, S * 0.03);
  ctx.fill();
  // Magazine.
  ctx.save();
  ctx.translate(S * 0.4, S * 0.11);
  ctx.rotate(0.34);
  ctx.fillStyle = palette.gunDark;
  roundRect(ctx, 0, 0, S * 0.12, S * 0.28, S * 0.04);
  ctx.fill();
  ctx.restore();
  // Front sight.
  ctx.fillStyle = palette.gunDark;
  roundRect(ctx, S * 0.94, -S * 0.14, S * 0.1, S * 0.1, S * 0.02);
  ctx.fill();
  ctx.restore();

  // --- torso ---------------------------------------------------------------
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.rotate(ang);
  // Backpack.
  ctx.fillStyle = palette.gear;
  roundRect(ctx, -S * 0.66, -S * 0.36, S * 0.28, S * 0.72, S * 0.09);
  ctx.fill();
  // Torso shell.
  ctx.fillStyle = palette.armor;
  roundRect(ctx, -S * 0.48, -S * 0.54, S * 1.08, S * 1.08, S * 0.32);
  ctx.fill();
  ctx.strokeStyle = palette.armorDark;
  ctx.lineWidth = 1.8;
  roundRect(ctx, -S * 0.48, -S * 0.54, S * 1.08, S * 1.08, S * 0.32);
  ctx.stroke();
  // Chest plate.
  ctx.fillStyle = palette.armorLight;
  roundRect(ctx, S * 0.06, -S * 0.32, S * 0.46, S * 0.64, S * 0.11);
  ctx.fill();
  ctx.strokeStyle = palette.armorDark;
  ctx.lineWidth = 1;
  roundRect(ctx, S * 0.06, -S * 0.32, S * 0.46, S * 0.64, S * 0.11);
  ctx.stroke();
  // Shoulder pads.
  ctx.fillStyle = palette.armorDark;
  roundRect(ctx, -S * 0.2, -S * 0.76, S * 0.48, S * 0.27, S * 0.11);
  ctx.fill();
  roundRect(ctx, -S * 0.2, S * 0.49, S * 0.48, S * 0.27, S * 0.11);
  ctx.fill();
  ctx.restore();

  // --- arms (two-handed grip on the foregrip + trigger) --------------------
  ctx.strokeStyle = palette.armorDark;
  capsule(ctx, FX(S * 0.04, -S * 0.6), FY(S * 0.04, -S * 0.6), FX(S * 0.84, -S * 0.14), FY(S * 0.84, -S * 0.14), S * 0.2);
  ctx.strokeStyle = palette.armor;
  capsule(ctx, FX(S * 0.04, S * 0.6), FY(S * 0.04, S * 0.6), FX(S * 0.44, S * 0.13), FY(S * 0.44, S * 0.13), S * 0.2);
  // Gloves.
  ctx.fillStyle = palette.gear;
  ctx.beginPath();
  ctx.arc(FX(S * 0.84, -S * 0.14), FY(S * 0.84, -S * 0.14), S * 0.12, 0, Math.PI * 2);
  ctx.arc(FX(S * 0.44, S * 0.13), FY(S * 0.44, S * 0.13), S * 0.12, 0, Math.PI * 2);
  ctx.fill();

  // --- helmet + visor ------------------------------------------------------
  const hx = FX(S * 0.12, 0);
  const hy = FY(S * 0.12, 0);
  ctx.fillStyle = palette.helmet;
  ctx.beginPath();
  ctx.arc(hx, hy, S * 0.36, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = palette.armorLight;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(hx, hy, S * 0.36, ang + Math.PI * 0.62, ang + Math.PI * 1.38);
  ctx.stroke();
  // Visor bar, facing forward.
  ctx.save();
  ctx.translate(FX(S * 0.17, 0), FY(S * 0.17, 0));
  ctx.rotate(ang);
  ctx.fillStyle = palette.visor;
  roundRect(ctx, 0, -S * 0.16, S * 0.17, S * 0.32, S * 0.06);
  ctx.fill();
  ctx.restore();
}

/** Additive muzzle flash at the barrel tip. intensity 1 → 0 over its life. */
export function drawMuzzleFlash(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dx: number,
  dy: number,
  team: 0 | 1,
  intensity: number,
): void {
  const volt = team === 0;
  const core = volt ? "#FBFFE8" : "#FFE4E9";
  const mid = volt ? "#E4FF70" : "#FF8DA1";
  const len = 12 + 20 * intensity;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.translate(x, y);
  ctx.rotate(Math.atan2(dy, dx));
  // Star spikes.
  ctx.fillStyle = mid;
  ctx.globalAlpha = Math.min(1, intensity * 1.2);
  ctx.beginPath();
  ctx.moveTo(len, 0);
  ctx.lineTo(len * 0.35, -len * 0.3);
  ctx.lineTo(len * 0.12, 0);
  ctx.lineTo(len * 0.35, len * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(2, -len * 0.44);
  ctx.lineTo(len * 0.2, -len * 0.12);
  ctx.lineTo(len * 0.2, len * 0.12);
  ctx.lineTo(2, len * 0.44);
  ctx.closePath();
  ctx.fill();
  // Hot core.
  ctx.globalAlpha = Math.min(1, intensity * 1.4);
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(1, 0, 3 + 2.6 * intensity, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** Corner-bracket reticle floating ahead of the striker's muzzle line. */
export function drawReticle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  aimX: number,
  aimY: number,
  dist: number,
): void {
  const al = Math.hypot(aimX, aimY);
  if (al < 1e-5) return;
  const ux = aimX / al;
  const uy = aimY / al;
  const cx = x + ux * dist;
  const cy = y + uy * dist;
  const r = 8;
  const g = 4.5;
  ctx.strokeStyle = "rgba(200,243,29,0.55)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    ctx.moveTo(cx + sx * r, cy + sy * r - sy * g);
    ctx.lineTo(cx + sx * r, cy + sy * r);
    ctx.lineTo(cx + sx * r - sx * g, cy + sy * r);
  }
  ctx.stroke();
  ctx.fillStyle = "rgba(200,243,29,0.8)";
  ctx.fillRect(cx - 1, cy - 1, 2, 2);
}
