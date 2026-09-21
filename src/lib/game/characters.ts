/**
 * VOIDSTRIKE — side-view soldier characters (2.5D billboard rig).
 *
 * The deterministic sim is top-down; the presentation layer projects the
 * floor plane with a fixed camera pitch (TILT) and draws every operative
 * as an upright side-view soldier: articulated legs with a walk cycle,
 * armored torso, backpack, helmeted head with visor, and a two-handed
 * rifle that tracks the aim vector (with a clamped visual pitch).
 *
 * Purely cosmetic render-layer code: the deterministic sim is never
 * touched. Animation state (gait phase, smoothed facing, per-bot shot
 * tracking) lives in a WeakMap keyed by the sim entities themselves —
 * no allocation per frame, no cleanup, zero coupling back into World.
 */

import type { Fighter } from "@/lib/sim/types";
import type { World } from "@/lib/sim/world";

// ---------------------------------------------------------------- projection

/** Camera pitch — floor y is squashed by this factor on screen. */
export const TILT = 0.58;

/**
 * Vertical offset that centers the projected arena inside the 1600×900
 * canvas: floor spans GROUND_OFFSET..GROUND_OFFSET + WORLD_H*TILT, with
 * soldier rigs reaching ~100 units above their ground anchor.
 */
export const GROUND_OFFSET = 238;

/** Floor-space y → screen-space ground line y. */
export function groundY(worldY: number): number {
  return worldY * TILT + GROUND_OFFSET;
}

/** Screen-space ground line y → floor-space y (inverse of groundY). */
export function worldYFromGround(gy: number): number {
  return (gy - GROUND_OFFSET) / TILT;
}

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
 * (rifle, torso, legs) reads at arena scale.
 */
export const VISUAL_SCALE = 2.6;

/** Where the visual barrel tip sits, in world units from the fighter origin. */
export function visualMuzzle(radius: number): number {
  return radius * VISUAL_SCALE * 1.06;
}

/**
 * Distance from the sim projectile spawn point (radius + 6) to the visual
 * barrel tip — used to anchor muzzle flashes onto the gun.
 */
export function muzzleExtension(radius: number): number {
  return Math.max(0, visualMuzzle(radius) - (radius + 6));
}

/** Rig proportions (fractions of S = radius * VISUAL_SCALE). */
const LEG_L = 0.92;
const TORSO_H = 0.88;
const TORSO_W = 0.74;
const HEAD_R = 0.30;
/** Height of the rifle line above the ground anchor (gun shoulder line). */
const SHOULDER_LIFT = LEG_L + TORSO_H - 0.2;
/** Chest line used to float tracers / reticle / flashes above the floor. */
const CHEST_LIFT = LEG_L + TORSO_H * 0.55;

/** Visual muzzle pitch clamp (radians from horizontal). */
const MAX_PITCH = 1.05;

export function soldierChestLift(radius: number): number {
  return radius * VISUAL_SCALE * CHEST_LIFT;
}

/**
 * Gun-muzzle tip for a fighter in screen space (projected ground line,
 * chest height). Used by the renderer to anchor muzzle flashes.
 */
export function gunTip(
  f: Fighter,
  aimX: number,
  aimY: number,
): { x: number; y: number } {
  const S = f.radius * VISUAL_SCALE;
  const dir = aimX >= 0 ? 1 : -1;
  const pitch = clampPitch(aimX, aimY);
  const gl = S * 0.98;
  return {
    x: f.x + dir * Math.cos(pitch) * gl,
    y: groundY(f.y) - S * SHOULDER_LIFT - Math.sin(pitch) * gl,
  };
}

function clampPitch(aimX: number, aimY: number): number {
  const p = Math.atan2(-aimY * TILT, Math.abs(aimX) + 1e-5);
  return Math.max(-MAX_PITCH, Math.min(MAX_PITCH, p));
}

interface FighterAnim {
  /** Smoothed facing direction (unit-ish vector). */
  fx: number;
  fy: number;
  /** Body side: 1 = faces right, -1 = faces left (hysteresis on aim). */
  dir: 1 | -1;
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
      dir: 1,
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
 * Update + draw one operative as an upright side-view soldier standing at
 * its projected floor anchor. `aimX/aimY` is the intent direction (player
 * reticle or bot attack heading) in floor space.
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

  // --- facing (smoothing feeds the rifle snap; body side is hysteresis) ----
  a.sinceShot += dt;
  if (moveAmt > 0.08) {
    const last = Math.hypot(f.vx, f.vy);
    if (last > 1) steer(a, f.vx / last, f.vy / last, dt, 9);
  }
  if (a.sinceShot < 0.45) steer(a, a.shotDx, a.shotDy, dt, 16);
  steer(a, aimX, aimY, dt, opts.isPlayer ? 18 : 10);

  // Body side flips only when the intent clearly crosses the vertical —
  // hysteresis stops jitter while tracking a target nearly overhead.
  const side = Math.abs(aimX) > 0.14 ? (aimX >= 0 ? 1 : -1) : a.dir;
  a.dir = side;
  const dir = side;

  const S = f.radius * VISUAL_SCALE;
  const ax = f.x;
  const ay = groundY(f.y);

  // --- team glow + contact shadow (symmetric, under everything) -----------
  ctx.fillStyle = volt ? "rgba(200,243,29,0.07)" : "rgba(255,61,90,0.08)";
  ctx.beginPath();
  ctx.ellipse(ax, ay - S * 0.1, S * 1.15, S * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath();
  ctx.ellipse(ax, ay + S * 0.04, S * 0.62, S * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // --- walk cycle ----------------------------------------------------------
  const phase0 = (a.gait / (S * 2.9)) * Math.PI * 2;
  // Walking away from the aim side reads as a backward shuffle — invert.
  const backPedal = moveAmt > 0.08 && dx / Math.max(dist, 1e-4) * dir < 0;
  const phase = backPedal ? -phase0 : phase0;
  const swing = S * 0.42 * a.stride;
  const bob = Math.abs(Math.sin(phase0)) * S * 0.05 * a.stride;
  const hipY = -S * LEG_L + bob;
  const torsoTop = hipY - S * TORSO_H;
  const headCy = torsoTop - S * HEAD_R * 0.95;
  const shoulderX = S * 0.1;
  const shoulderY = torsoTop + S * 0.24;

  // Rifle geometry follows the (clamped) aim pitch in the flipped frame.
  const pitch = clampPitch(aimX, aimY);
  const ga = -pitch; // local frame: +y is down
  const gc = Math.cos(ga);
  const gs = Math.sin(ga);
  const gripX = shoulderX + gc * S * 0.16;
  const gripY = shoulderY + gs * S * 0.16 + S * 0.05;
  const foreX = shoulderX + gc * S * 0.42;
  const foreY = shoulderY + gs * S * 0.42;

  ctx.save();
  ctx.translate(ax, ay);
  ctx.scale(dir, 1);

  // -- far leg (drawn first, shaded) ---------------------------------------
  const drawLeg = (i: 0 | 1, far: boolean): void => {
    const p = phase + (i === 0 ? 0 : Math.PI);
    const footX = Math.sin(p) * swing;
    const footY = -Math.max(0, Math.cos(p)) * S * 0.18;
    const hipX = i === 0 ? -S * 0.06 : S * 0.06;
    const kneeX = (hipX + footX) / 2 + S * 0.12;
    const kneeY = (hipY + footY) / 2;
    ctx.strokeStyle = far ? palette.armorDark : palette.gear;
    capsule(ctx, hipX, hipY, kneeX, kneeY, S * 0.2);
    capsule(ctx, kneeX, kneeY, footX, footY, S * 0.15);
    // Boot.
    ctx.fillStyle = far ? palette.gunDark : palette.gear;
    roundRect(ctx, footX - S * 0.1, footY - S * 0.07, S * 0.3, S * 0.14, S * 0.06);
    ctx.fill();
  };
  drawLeg(0, true);

  // -- rear arm (behind torso) ----------------------------------------------
  ctx.strokeStyle = palette.armorDark;
  capsule(ctx, -S * 0.08, shoulderY + S * 0.06, foreX, foreY, S * 0.17);

  // -- torso ---------------------------------------------------------------
  ctx.fillStyle = palette.gear;
  roundRect(ctx, -S * 0.52, torsoTop + S * 0.1, S * 0.26, S * 0.56, S * 0.08);
  ctx.fill(); // backpack
  ctx.fillStyle = palette.armor;
  roundRect(ctx, -S * TORSO_W / 2, torsoTop, S * TORSO_W, S * TORSO_H, S * 0.2);
  ctx.fill();
  ctx.strokeStyle = palette.armorDark;
  ctx.lineWidth = 1.6;
  roundRect(ctx, -S * TORSO_W / 2, torsoTop, S * TORSO_W, S * TORSO_H, S * 0.2);
  ctx.stroke();
  ctx.fillStyle = palette.armorLight;
  roundRect(ctx, S * 0.02, torsoTop + S * 0.13, S * 0.32, S * 0.5, S * 0.1);
  ctx.fill(); // chest plate
  ctx.fillStyle = palette.gear;
  roundRect(ctx, -S * TORSO_W / 2, torsoTop + S * TORSO_H - S * 0.14, S * TORSO_W, S * 0.14, S * 0.05);
  ctx.fill(); // belt

  // -- near leg -------------------------------------------------------------
  drawLeg(1, false);

  // -- head -----------------------------------------------------------------
  ctx.fillStyle = palette.gear;
  ctx.fillRect(-S * 0.07, torsoTop - S * 0.1, S * 0.14, S * 0.14); // neck
  ctx.fillStyle = palette.helmet;
  ctx.beginPath();
  ctx.arc(S * 0.03, headCy, S * HEAD_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = palette.armorLight;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(S * 0.03, headCy, S * HEAD_R * 0.86, -2.5, -0.9);
  ctx.stroke(); // rim light
  ctx.fillStyle = palette.visor;
  roundRect(ctx, S * 0.14, headCy - S * 0.1, S * 0.17, S * 0.2, S * 0.05);
  ctx.fill(); // visor

  // -- rifle (held in front, tracks the aim) --------------------------------
  ctx.save();
  ctx.translate(shoulderX, shoulderY);
  ctx.rotate(ga);
  ctx.fillStyle = palette.gunDark;
  roundRect(ctx, -S * 0.34, -S * 0.05, S * 0.36, S * 0.12, S * 0.04);
  ctx.fill(); // stock
  ctx.fillStyle = palette.gun;
  roundRect(ctx, 0, -S * 0.06, S * 0.5, S * 0.14, S * 0.04);
  ctx.fill(); // receiver
  ctx.fillStyle = palette.armor;
  roundRect(ctx, S * 0.06, -S * 0.025, S * 0.26, S * 0.06, S * 0.025);
  ctx.fill(); // energy cell
  ctx.fillStyle = palette.gunDark;
  roundRect(ctx, S * 0.5, -S * 0.035, S * 0.44, S * 0.08, S * 0.03);
  ctx.fill(); // barrel
  ctx.save();
  ctx.translate(S * 0.2, S * 0.07);
  ctx.rotate(0.3);
  ctx.fillStyle = palette.gunDark;
  roundRect(ctx, 0, 0, S * 0.1, S * 0.24, S * 0.035);
  ctx.fill();
  ctx.restore(); // magazine
  roundRect(ctx, S * 0.56, -S * 0.13, S * 0.09, S * 0.09, S * 0.02);
  ctx.fill(); // sight
  ctx.restore();

  // -- front arm + gloves (over the rifle) -----------------------------------
  ctx.strokeStyle = palette.armor;
  capsule(ctx, S * 0.02, shoulderY + S * 0.1, gripX, gripY, S * 0.17);
  ctx.fillStyle = palette.gear;
  ctx.beginPath();
  ctx.arc(gripX, gripY, S * 0.1, 0, Math.PI * 2);
  ctx.arc(foreX, foreY, S * 0.1, 0, Math.PI * 2);
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
