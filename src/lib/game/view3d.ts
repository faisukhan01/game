/**
 * VOIDSTRIKE — GTA-style third-person 3D view (Three.js).
 *
 * The deterministic 2D sim stays untouched; this module renders it as a
 * golden-hour city block seen from an over-the-shoulder follow camera:
 *
 *  - a real 3D "GROVE STREET" style setting: wide asphalt roads with lane
 *    markings and crosswalks, sidewalks, derelict low-rise buildings with
 *    boarded windows, neon signs, palms, parked wrecks and streetlights;
 *  - the five sim cover footprints become exact-match world objects
 *    (abandoned diner + four brick walls) so collisions stay honest;
 *  - articulated low-poly characters (protagonist in a backwards cap, red
 *    jacketed hostiles) with walk cycles, aim pose and ragdoll-ish deaths;
 *  - GTA camera behavior: behind-the-back follow cam that snaps closer and
 *    tighter over the right shoulder while firing, mouse look, wall
 *    collision, and a slow death pull-out;
 *  - tracers, muzzle flashes, sparks, nova rings, dash ghosts and floating
 *    damage numbers rendered in 3D / projected DOM.
 *
 * Sim (x, y) → world (x - 800, 0, y - 450). 1 meter = 20 world units.
 */

import * as THREE from "three";
import { OBSTACLES } from "@/lib/sim/constants";
import type { Fighter, Projectile } from "@/lib/sim/types";
import type { World } from "@/lib/sim/world";
import { COLOR_FLARE, COLOR_INK, COLOR_VOLT, type Effects } from "./effects";
import type { InputManager } from "./input";

// ------------------------------------------------------------------ scaling

/** Sim units per meter. */
const U = 20;
/** Sim x → world x. */
const WX = (x: number): number => x - 800;
/** Sim y → world z. */
const WZ = (y: number): number => y - 450;
/** Chest height for tracers / sparks / aim plane (1.3m). */
const CHEST = 1.3 * U;
/** Head height for the follow-cam target (1.7m). */
const HEAD = 1.7 * U;

// ------------------------------------------------------------------- shared

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  return [c, ctx];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lam(color: string, opts: Partial<THREE.MeshLambertMaterialParameters> = {}): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, ...opts });
}

function box(
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

// ------------------------------------------------------------ city textures

/** Asphalt: dark base with noise, cracks and oil stains. */
function asphaltTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = "#2b2d2f";
  ctx.fillRect(0, 0, 256, 256);
  let a = 99;
  const rnd = (): number => {
    a = (a * 16807) % 2147483647;
    return a / 2147483647;
  };
  for (let i = 0; i < 5200; i++) {
    const g = 30 + rnd() * 34;
    ctx.fillStyle = `rgba(${g},${g},${g + 2},${0.16 + rnd() * 0.2})`;
    ctx.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 2.2, 1 + rnd() * 2.2);
  }
  for (let i = 0; i < 7; i++) {
    ctx.strokeStyle = "rgba(12,12,14,0.35)";
    ctx.lineWidth = 0.8 + rnd() * 1.4;
    ctx.beginPath();
    let x = rnd() * 256;
    let y = rnd() * 256;
    ctx.moveTo(x, y);
    for (let s = 0; s < 5; s++) {
      x += (rnd() - 0.5) * 70;
      y += (rnd() - 0.5) * 70;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 4; i++) {
    const x = rnd() * 256;
    const y = rnd() * 256;
    const r = 8 + rnd() * 22;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(10,10,12,0.4)");
    g.addColorStop(1, "rgba(10,10,12,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Concrete sidewalk slabs with expansion joints. */
function sidewalkTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = "#8f8c83";
  ctx.fillRect(0, 0, 256, 256);
  let a = 7;
  const rnd = (): number => {
    a = (a * 48271) % 2147483647;
    return a / 2147483647;
  };
  for (let i = 0; i < 2600; i++) {
    const g = 120 + rnd() * 40;
    ctx.fillStyle = `rgba(${g},${g - 2},${g - 8},0.14)`;
    ctx.fillRect(rnd() * 256, rnd() * 256, 1.6, 1.6);
  }
  ctx.strokeStyle = "rgba(70,68,62,0.55)";
  ctx.lineWidth = 2;
  for (let i = 0; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo((i * 256) / 2, 0);
    ctx.lineTo((i * 256) / 2, 256);
    ctx.moveTo(0, (i * 256) / 2);
    ctx.lineTo(256, (i * 256) / 2);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Derelict building face: tinted wall, window grid, boards, grime. */
function buildingTexture(tint: string, seed: number, litChance: number): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 256);
  const rnd = mulberry32(seed);
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, 256, 256);
  // Grime gradient from the base.
  const g = ctx.createLinearGradient(0, 256, 0, 120);
  g.addColorStop(0, "rgba(30,24,18,0.42)");
  g.addColorStop(1, "rgba(30,24,18,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  // 4×4 window grid.
  for (let wy = 0; wy < 4; wy++) {
    for (let wx = 0; wx < 4; wx++) {
      const x = 22 + wx * 56;
      const y = 20 + wy * 58;
      const w = 36;
      const h = 42;
      if (rnd() < 0.24) {
        // Boarded up.
        ctx.fillStyle = "#191712";
        ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
        ctx.fillStyle = "#6b543a";
        ctx.save();
        ctx.translate(x + w / 2, y + h / 2);
        ctx.rotate((rnd() - 0.5) * 0.16);
        ctx.fillRect(-w / 2 - 3, -5, w + 6, 10);
        ctx.rotate(0.34);
        ctx.fillRect(-w / 2 - 3, -5, w + 6, 10);
        ctx.restore();
      } else {
        ctx.fillStyle = "#141a20";
        ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
        const lit = rnd() < litChance;
        ctx.fillStyle = lit
          ? `rgba(255,196,110,${0.55 + rnd() * 0.4})`
          : "rgba(52,66,78,0.85)";
        ctx.fillRect(x, y, w, h);
        if (!lit && rnd() < 0.5) {
          // Shattered pane.
          ctx.strokeStyle = "rgba(10,12,14,0.9)";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(x + 4, y + 6 + rnd() * 20);
          ctx.lineTo(x + w - 6, y + 10 + rnd() * 24);
          ctx.moveTo(x + w / 2, y + 3);
          ctx.lineTo(x + w / 2 - 8, y + h - 4);
          ctx.stroke();
        }
      }
      ctx.strokeStyle = "rgba(20,16,12,0.5)";
      ctx.strokeRect(x - 2.5, y - 2.5, w + 5, h + 5);
    }
  }
  // Streaks under some windows.
  for (let i = 0; i < 5; i++) {
    const x = 24 + rnd() * 210;
    ctx.fillStyle = "rgba(24,20,14,0.22)";
    ctx.fillRect(x, 60 + rnd() * 80, 3 + rnd() * 5, 60 + rnd() * 60);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Graffiti tag strip for cover walls. */
function graffitiTexture(seed: number): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 128);
  const rnd = mulberry32(seed);
  ctx.fillStyle = "#5d4434";
  ctx.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 900; i++) {
    const g = 70 + rnd() * 34;
    ctx.fillStyle = `rgba(${g},${g * 0.72},${g * 0.5},0.18)`;
    ctx.fillRect(rnd() * 256, rnd() * 128, 2, 2);
  }
  const tags = ["#C8F31D", "#E05274", "#3EC9A7", "#E8E4D8"];
  for (let i = 0; i < 3; i++) {
    const col = tags[Math.floor(rnd() * tags.length)];
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.62;
    ctx.lineWidth = 5 + rnd() * 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    let x = 26 + rnd() * 30;
    let y = 40 + rnd() * 48;
    ctx.moveTo(x, y);
    const segs = 4 + Math.floor(rnd() * 4);
    for (let s = 0; s < segs; s++) {
      x += 14 + rnd() * 26;
      y += (rnd() - 0.5) * 52;
      y = Math.max(24, Math.min(104, y));
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Neon sign plane (emissive text on dark). */
function signTexture(text: string, color: string): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 96);
  ctx.fillStyle = "#101114";
  ctx.fillRect(0, 0, 256, 96);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.35;
  ctx.strokeRect(6, 6, 244, 84);
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.font = "900 52px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.fillText(text, 128, 52);
  ctx.fillText(text, 128, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft radial sprite (muzzle flash / glow). */
function glowTexture(inner: string, outer: string): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, outer);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// --------------------------------------------------------------- the figures

interface FigurePalette {
  jacket: string;
  jacketDark: string;
  pants: string;
  shoes: string;
  skin: string;
  hat: string;
  accent: string;
}

const P_PLAYER: FigurePalette = {
  jacket: "#20242a",
  jacketDark: "#14171b",
  pants: "#262b33",
  shoes: "#e4e2da",
  skin: "#b98a63",
  hat: "#121316",
  accent: "#c8f31d",
};

const P_BOT: FigurePalette = {
  jacket: "#8c2733",
  jacketDark: "#5c1a23",
  pants: "#23252b",
  shoes: "#2e3033",
  skin: "#a97a55",
  hat: "#4d151d",
  accent: "#ff3d5a",
};

interface Rig {
  root: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  rifle: THREE.Group;
  hpBar: THREE.Sprite;
  gait: number;
  stride: number;
  yaw: number;
  lx: number;
  ly: number;
  deadAt: number;
}

const RIFLE_MAT_DARK = lam("#15171b");
const RIFLE_MAT_MID = lam("#24272d");

function buildRifle(accent: string): THREE.Group {
  const g = new THREE.Group();
  const receiver = box(2.1, 1.5, 10.5, RIFLE_MAT_MID, 0, 0, 0);
  const barrel = box(0.8, 0.8, 7.5, RIFLE_MAT_DARK, 0, 0.25, 8.6);
  const stock = box(1.4, 1.9, 4.2, RIFLE_MAT_DARK, 0, -0.35, -6.4);
  const mag = box(1.2, 3.6, 1.7, RIFLE_MAT_DARK, 0, -2.2, 1.6);
  const grip = box(1.1, 2.4, 1.4, RIFLE_MAT_DARK, 0, -1.7, -2.6);
  const sight = box(0.6, 1.0, 2.4, RIFLE_MAT_DARK, 0, 1.2, 2.2);
  const cell = box(0.7, 0.7, 3.4, lam(accent), 0, 0.45, 0.6);
  g.add(receiver, barrel, stock, mag, grip, sight, cell);
  return g;
}

function buildFigure(p: FigurePalette): Rig {
  const root = new THREE.Group();

  const hipsY = 17.5;

  const mkLeg = (side: number): { hip: THREE.Group; knee: THREE.Group } => {
    const hip = new THREE.Group();
    hip.position.set(side * 3.2, hipsY, 0);
    const upper = box(3.1, 8.6, 3.4, lam(p.pants), 0, -4.3, 0);
    const knee = new THREE.Group();
    knee.position.set(0, -8.6, 0);
    const lower = box(2.6, 7.6, 2.9, lam(p.pants), 0, -3.8, 0);
    const shoe = box(3.0, 1.8, 5.4, lam(p.shoes), 0, -8.2, 1.1);
    const stripe = box(3.06, 0.5, 5.44, lam(p.accent), 0, -7.9, 1.1);
    knee.add(lower, shoe, stripe);
    hip.add(upper, knee);
    return { hip, knee };
  };
  const { hip: legL, knee: kneeL } = mkLeg(-1);
  const { hip: legR, knee: kneeR } = mkLeg(1);

  const torso = new THREE.Group();
  torso.position.set(0, hipsY, 0);
  const jacket = box(9.6, 13.5, 5.6, lam(p.jacket), 0, 6.9, 0);
  const jacketShade = box(9.7, 4.4, 5.7, lam(p.jacketDark), 0, 1.9, 0);
  const chest = box(6.4, 6.2, 0.7, lam(p.jacketDark), 0, 8.6, 2.9);
  const stripe = box(9.66, 0.9, 5.66, lam(p.accent), 0, 10.6, 0);
  const pack = box(5.6, 7.0, 2.6, lam(p.jacketDark), 0, 7.4, -3.6);
  torso.add(jacket, jacketShade, chest, stripe, pack);

  const head = new THREE.Group();
  head.position.set(0, 14.6, 0.2);
  const skull = box(5.4, 5.4, 5.4, lam(p.skin), 0, 0, 0);
  const cap = box(5.8, 2.0, 5.8, lam(p.hat), 0, 2.1, 0);
  const brim = box(5.2, 0.7, 2.6, lam(p.hat), 0, 1.9, -3.6); // backwards
  const shades = box(4.6, 1.3, 0.6, lam("#0c0d10"), 0, 0.4, 2.8);
  head.add(skull, cap, brim, shades);

  const mkArm = (side: number): THREE.Group => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 5.9, 12.4, 0);
    const upper = box(2.4, 8.2, 2.6, lam(p.jacket), 0, -3.6, 0);
    const fore = box(2.0, 6.4, 2.2, lam(p.skin), 0, -9.6, 0);
    shoulder.add(upper, fore);
    return shoulder;
  };
  const armL = mkArm(-1);
  const armR = mkArm(1);

  const rifle = buildRifle(p.accent);
  rifle.position.set(3.4, 9.2, 4.4);

  root.add(legL, legR, torso);
  torso.add(head, armL, armR, rifle);

  // HP bar (billboard sprite).
  const hpTex = glowTexture("rgba(255,255,255,1)", "rgba(255,255,255,1)");
  const hpBar = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: hpTex, color: "#ff3d5a", depthTest: false }),
  );
  hpBar.scale.set(11, 1.6, 1);
  hpBar.position.y = 45;
  hpBar.visible = false;
  root.add(hpBar);

  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });

  return {
    root,
    legL,
    legR,
    kneeL,
    kneeR,
    torso,
    head,
    armL,
    armR,
    rifle,
    hpBar,
    gait: 0,
    stride: 0,
    yaw: 0,
    lx: 0,
    ly: 0,
    deadAt: -1,
  };
}

function poseRig(rig: Rig, f: Fighter, aimX: number, aimY: number, dt: number): void {
  if (f.dead) return;
  const dist = Math.hypot(f.x - rig.lx, f.y - rig.ly);
  rig.lx = f.x;
  rig.ly = f.y;
  rig.gait += dist;
  const speed = Math.hypot(f.vx, f.vy);
  const moveAmt = Math.min(1, speed / Math.max(f.speed, 1));
  rig.stride += (moveAmt - rig.stride) * (1 - Math.exp(-12 * dt));

  // Face the aim while fighting, else face travel.
  let tx = aimX;
  let ty = aimY;
  if (Math.hypot(tx, ty) < 1e-4 && speed > 20) {
    tx = f.vx;
    ty = f.vy;
  }
  if (Math.hypot(tx, ty) > 1e-4) {
    const target = Math.atan2(tx, -ty);
    let d = target - rig.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    rig.yaw += d * (1 - Math.exp(-14 * dt));
  }
  rig.root.rotation.y = rig.yaw;

  // Walk cycle.
  const phase = rig.gait * 0.135;
  const swing = 0.82 * rig.stride;
  const bob = Math.abs(Math.cos(phase)) * 0.55 * rig.stride;
  rig.legL.rotation.x = Math.sin(phase) * swing;
  rig.legR.rotation.x = Math.sin(phase + Math.PI) * swing;
  rig.kneeL.rotation.x = Math.max(0, -Math.sin(phase - 0.6)) * 1.05 * rig.stride;
  rig.kneeR.rotation.x = Math.max(0, -Math.sin(phase + Math.PI - 0.6)) * 1.05 * rig.stride;
  rig.torso.position.y = 17.5 + bob;
  rig.torso.rotation.x = 0.10 * rig.stride;
  rig.torso.rotation.z = Math.sin(phase) * 0.05 * rig.stride;

  // Aim pitch on the rifle + arms (visual, clamped).
  const pitch = Math.atan2(aimY, Math.abs(aimX) + 1e-4);
  const clamped = Math.max(-0.72, Math.min(0.72, pitch * 0.62));
  rig.rifle.rotation.x = -clamped;

  const hasAim = Math.hypot(aimX, aimY) > 1e-4;
  const raise = hasAim ? 1 : 0.25;
  rig.armR.rotation.x = -1.25 * raise + 0.55 * (1 - raise);
  rig.armR.rotation.z = -0.22 * raise;
  rig.armL.rotation.x = -1.42 * raise + 0.55 * (1 - raise);
  rig.armL.rotation.z = 0.5 * raise;
}

/** Death animation progress → transform. Returns false when fully gone. */
function poseDead(rig: Rig, dt: number): boolean {
  if (rig.deadAt < 0) rig.deadAt = 0;
  rig.deadAt += dt;
  const t = rig.deadAt;
  if (t < 0.42) {
    rig.root.rotation.x = -(t / 0.42) * (Math.PI / 2) * 0.94;
    rig.root.position.y = 1.4 * (t / 0.42);
  } else if (t < 1.5) {
    rig.root.rotation.x = -Math.PI / 2 * 0.94;
    rig.root.position.y = 1.4;
  } else if (t < 2.1) {
    const k = (t - 1.5) / 0.6;
    rig.root.position.y = 1.4 - k * 3.2;
    rig.hpBar.visible = false;
  } else {
    rig.root.visible = false;
    return false;
  }
  return true;
}

// -------------------------------------------------------------------- city

interface CoverPieces {
  meshes: THREE.Mesh[];
}

/**
 * Build the whole city. Cover structures sit EXACTLY on the sim obstacle
 * footprints (collision honesty); everything else is placed outside the
 * playable bounds [0..1600]×[0..900].
 */
function buildCity(scene: THREE.Scene): CoverPieces {
  const group = new THREE.Group();
  scene.add(group);
  const colliders: THREE.Mesh[] = [];
  const rnd = mulberry32(20250131);

  // ---- ground: asphalt across the whole block ---------------------------
  const asphalt = asphaltTexture();
  asphalt.repeat.set(26, 16);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(3600, 2400),
    new THREE.MeshLambertMaterial({ map: asphalt }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Road markings (flat decals on the asphalt, inside the playfield).
  const decal = (w: number, d: number, x: number, z: number, color: string): THREE.Mesh => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({ color }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.25, z);
    group.add(m);
    return m;
  };
  // Dashed lane dividers running east–west (three lanes).
  for (const laneZ of [-150, 0, 150]) {
    for (let x = -760; x <= 760; x += 90) {
      decal(38, 3, x, laneZ, "#d8d4c2");
    }
  }
  // Crosswalks near both ends.
  for (const cx of [-640, 640]) {
    for (let i = 0; i < 7; i++) {
      decal(10, 200, cx + i * 20, 0, "rgba(226,222,208,0.85)");
    }
  }
  // Faded stop lines + big worn graffiti circle in the middle.
  decal(6, 330, -700, 0, "rgba(216,212,194,0.5)");
  decal(6, 330, 700, 0, "rgba(216,212,194,0.5)");

  // Manholes.
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(
      new THREE.CircleGeometry(5, 20),
      new THREE.MeshLambertMaterial({ color: "#1d1f21" }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(-600 + rnd() * 1200, 0.22, -300 + rnd() * 600);
    group.add(m);
  }

  // ---- sidewalks (raised, outside the play bounds) ----------------------
  const swTex = sidewalkTexture();
  const sidewalk = (w: number, d: number, x: number, z: number): void => {
    const t = swTex.clone();
    t.needsUpdate = true;
    t.repeat.set(w / 40, d / 40);
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, 1.6, d),
      new THREE.MeshLambertMaterial({ map: t }),
    );
    m.position.set(x, 0.8, z);
    m.receiveShadow = true;
    group.add(m);
  };
  const SW_D = 130;
  sidewalk(3600, SW_D, 0, -450 - SW_D / 2 - 1.6);
  sidewalk(3600, SW_D, 0, 450 + SW_D / 2 + 1.6);
  sidewalk(SW_D, 900 + SW_D * 2, -800 - SW_D / 2 - 1.6, 0);
  sidewalk(SW_D, 900 + SW_D * 2, 800 + SW_D / 2 + 1.6, 0);
  // Curb strips facing the road.
  const curbMat = lam("#7c7a72");
  for (const z of [-452, 452]) {
    const curb = box(3600, 2.2, 5, curbMat, 0, 1.1, z);
    curb.receiveShadow = true;
    group.add(curb);
  }

  // ---- perimeter buildings (beyond the sidewalks) -----------------------
  const faceTexes = [
    buildingTexture("#6e4a3a", 11, 0.1), // brick
    buildingTexture("#77796f", 23, 0.16), // concrete
    buildingTexture("#93876e", 37, 0.12), // faded paint
    buildingTexture("#5f6a72", 41, 0.2), // blue-gray
  ];
  const mkBuilding = (
    w: number,
    d: number,
    h: number,
    x: number,
    z: number,
    texIdx: number,
    face: "n" | "s" | "e" | "w",
  ): void => {
    const t = faceTexes[texIdx % faceTexes.length].clone();
    t.needsUpdate = true;
    const cols = Math.max(1, Math.round(w / 55));
    const rows = Math.max(1, Math.round(h / 52));
    t.repeat.set(cols, rows);
    const mats = Array.from({ length: 6 }, () => lam("#3a3c3e"));
    mats[face === "n" ? 2 : face === "s" ? 3 : face === "w" ? 0 : 1] =
      new THREE.MeshLambertMaterial({ map: t });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
    m.position.set(x, h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    colliders.push(m);
    // Roof clutter: AC boxes + water tank.
    if (rnd() < 0.7) group.add(box(14, 6, 12, lam("#8e9094"), x + (rnd() - 0.5) * w * 0.5, h + 3, z + (rnd() - 0.5) * d * 0.4));
    if (rnd() < 0.5) group.add(box(10, 4.5, 10, lam("#6f7174"), x + (rnd() - 0.5) * w * 0.4, h + 2.2, z + (rnd() - 0.5) * d * 0.4));
  };
  // North row (behind z < -580) & south row (z > 580).
  for (const side of [-1, 1]) {
    let x = -1900;
    while (x < 1900) {
      const w = 220 + rnd() * 240;
      const d = 200 + rnd() * 260;
      const h = 90 + rnd() * 260;
      const zSide = side < 0 ? -580 - d / 2 - rnd() * 30 : 580 + d / 2 + rnd() * 30;
      mkBuilding(w, d, h, x + w / 2, zSide, Math.floor(rnd() * 4), side < 0 ? "s" : "n");
      x += w + 14 + rnd() * 30;
    }
  }
  // East & west towers closing the avenue.
  for (const side of [-1, 1]) {
    let z = -1500;
    while (z < 1500) {
      const w = 200 + rnd() * 220;
      const d = 220 + rnd() * 200;
      const h = 150 + rnd() * 320;
      const xSide = side < 0 ? -1020 - w / 2 : 1020 + w / 2;
      mkBuilding(w, d, h, xSide, z + d / 2, Math.floor(rnd() * 4), side < 0 ? "e" : "w");
      z += d + 16 + rnd() * 26;
    }
  }

  // Neon signs on a few facades.
  const signs: Array<[string, string, number, number, number, number]> = [
    ["DINER", "#ff5a5a", -420, 96, -574, 0],
    ["MOTEL", "#ffb020", 380, 120, 574, Math.PI],
    ["PAWN", "#3ec9a7", 890, 88, -300, -Math.PI / 2],
    ["LIQUOR", "#ff5a5a", -890, 104, 240, Math.PI / 2],
    ["24 HR", "#c8f31d", -80, 132, 574, Math.PI],
  ];
  for (const [text, color, x, y, z, rotY] of signs) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 44),
      new THREE.MeshBasicMaterial({ map: signTexture(text, color) }),
    );
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    group.add(m);
  }

  // Street lights along both sidewalks.
  const lampGlow = glowTexture("rgba(255,225,160,1)", "rgba(255,190,90,0.4)");
  for (let x = -740; x <= 740; x += 240) {
    for (const z of [-540, 540]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.5, 92, 8), lam("#3c4046"));
      pole.position.set(x, 46, z);
      pole.castShadow = true;
      const arm = box(3, 2.2, 26, lam("#3c4046"), 0, 90, z > 0 ? -12 : 12);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(3.4, 10, 8), new THREE.MeshBasicMaterial({ color: "#ffe6b0" }));
      lamp.position.set(0, 89, z > 0 ? -23 : 23);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: lampGlow, color: 0xffd890, transparent: true, opacity: 0.8, depthWrite: false }));
      halo.scale.set(34, 34, 1);
      halo.position.copy(lamp.position);
      const g = new THREE.Group();
      g.add(pole, arm, lamp, halo);
      g.position.set(x, 0, z);
      group.add(g);
      colliders.push(pole);
    }
  }

  // Palms (Los Santos style) between lights.
  for (let x = -620; x <= 620; x += 240) {
    for (const z of [-560, 560]) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.6, 110, 7), lam("#7a5b3a"));
      trunk.position.set(x, 55, z);
      trunk.castShadow = true;
      const g = new THREE.Group();
      g.add(trunk);
      for (let i = 0; i < 7; i++) {
        const frond = new THREE.Mesh(new THREE.ConeGeometry(4.5, 42, 4), lam("#3f7a3c"));
        frond.position.set(Math.cos((i / 7) * Math.PI * 2) * 12, 112, Math.sin((i / 7) * Math.PI * 2) * 12);
        frond.rotation.z = Math.cos((i / 7) * Math.PI * 2) * 1.25;
        frond.rotation.x = Math.sin((i / 7) * Math.PI * 2) * 1.25;
        frond.castShadow = true;
        g.add(frond);
      }
      g.position.set(x, 0, z);
      group.add(g);
    }
  }

  // Parked derelict cars half on the sidewalk (outside play bounds).
  const carColors = ["#7d3328", "#3f5a52", "#575c60", "#8a7f5a", "#31363c"];
  const mkCar = (x: number, z: number, rotY: number): void => {
    const g = new THREE.Group();
    const bodyMat = lam(carColors[Math.floor(rnd() * carColors.length)]);
    const body = box(34, 9, 78, bodyMat, 0, 8, 0);
    const cabin = box(30, 8, 34, lam("#22262b"), 0, 15, -4);
    const wl = box(4, 4, 4, lam("#0f1113"), -17, 4, 24);
    const wr = box(4, 4, 4, lam("#0f1113"), 17, 4, 24);
    const rl = box(4, 4, 4, lam("#0f1113"), -17, 4, -24);
    const rr = box(4, 4, 4, lam("#0f1113"), 17, 4, -24);
    g.add(body, cabin, wl, wr, rl, rr);
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    group.add(g);
  };
  mkCar(-560, -498, 0);
  mkCar(-160, -502, 0.04);
  mkCar(300, -498, 0);
  mkCar(660, -502, -0.05);
  mkCar(-420, 498, 0);
  mkCar(60, 502, 0.05);
  mkCar(520, 498, 0);
  mkCar(760, 502, -0.04);

  // Dumpsters + hydrant + trash bags (sidewalk dressing).
  const dumpster = (x: number, z: number, rotY: number): void => {
    const g = new THREE.Group();
    const bodyM = lam("#2e4a38");
    g.add(box(40, 18, 20, bodyM, 0, 9, 0));
    g.add(box(41, 2, 21, lam("#243b2d"), 0, 18.6, 0));
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    group.add(g);
  };
  dumpster(-660, -548, 0.2);
  dumpster(470, 550, -0.15);
  dumpster(150, 548, 0.08);
  const hydrant = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3, 7, 8), lam("#8c2733"));
  hydrant.position.set(-320, 3.5, -536);
  hydrant.castShadow = true;
  group.add(hydrant);
  for (let i = 0; i < 7; i++) {
    const bag = new THREE.Mesh(new THREE.SphereGeometry(3.2, 7, 6), lam("#17181b"));
    bag.scale.y = 0.8;
    bag.position.set(-690 + rnd() * 90, 2.4, 540 + rnd() * 24);
    bag.castShadow = true;
    group.add(bag);
  }

  // ---- cover structures ON the sim footprints ---------------------------
  const graffA = graffitiTexture(7);
  const graffB = graffitiTexture(19);
  const steelMat = lam("#4c5157");
  const brickMat = lam("#63432f");

  const coverWall = (x: number, y: number, w: number, h: number, idx: number): void => {
    // Brick parapet wall, exact footprint, 2.2m high, chipped top.
    const g = new THREE.Group();
    const wx = WX(x + w / 2);
    const wz = WZ(y + h / 2);
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, 44, h), brickMat);
    body.position.set(0, 22, 0);
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    // Steel patch + graffiti decal on the long faces.
    for (const s of [1, -1]) {
      const decalM = new THREE.Mesh(
        new THREE.PlaneGeometry(w * 0.9, 26),
        new THREE.MeshLambertMaterial({ map: s > 0 ? graffA : graffB }),
      );
      decalM.position.set(0, 22, (s * h) / 2 + 0.3);
      if (s < 0) decalM.rotation.y = Math.PI;
      g.add(decalM);
    }
    const patch = box(w * 0.3, 18, 1.4, steelMat, -w * 0.2, 24, h / 2 + 0.8);
    g.add(patch);
    // Chipped crown.
    for (let i = 0; i < 5; i++) {
      const c = box(8 + rnd() * 10, 3 + rnd() * 3, h, brickMat, -w / 2 + 12 + i * (w / 5), 44.5, 0);
      g.add(c);
    }
    g.position.set(wx, 0, wz);
    g.rotation.y = Math.PI / 2; // long axis runs along sim x
    group.add(g);
    colliders.push(body);
  };

  // The four perimeter cover walls are 220 wide × 40 deep in sim space.
  coverWall(200, 150, 220, 40, 0);
  coverWall(1180, 150, 220, 40, 1);
  coverWall(200, 710, 220, 40, 2);
  coverWall(1180, 710, 220, 40, 3);

  // Central abandoned diner (200×60 footprint, 3.4m tall shell).
  {
    const w = 200;
    const h = 60;
    const wx = WX(700 + w / 2);
    const wz = WZ(420 + h / 2);
    const g = new THREE.Group();
    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(w, 68, h),
      new THREE.MeshLambertMaterial({ color: "#9c8e76" }),
    );
    shell.position.y = 34;
    shell.castShadow = true;
    shell.receiveShadow = true;
    g.add(shell);
    // Boarded service window + door on the long faces.
    for (const s of [1, -1]) {
      const board = box(64, 26, 1.6, lam("#6b543a"), -30, 30, (s * h) / 2 + 0.9);
      const board2 = box(40, 20, 1.6, lam("#5d4a34"), 46, 28, (s * h) / 2 + 0.9);
      const strip = box(70, 6, 1.8, lam("#31363c"), -30, 44, (s * h) / 2 + 0.9);
      g.add(board, board2, strip);
    }
    // Roofline + faded awning frame.
    const roofTrim = box(w + 4, 5, h + 4, lam("#4a3c2c"), 0, 70, 0);
    g.add(roofTrim);
    // AC unit on the roof.
    const ac = box(26, 10, 18, lam("#787c80"), 40, 74, 0);
    ac.castShadow = true;
    g.add(ac);
    // Diner sign above the roof, both faces.
    const tex = signTexture("DINER", "#ff5a5a");
    for (const s of [1, -1]) {
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(110, 40),
        new THREE.MeshBasicMaterial({ map: tex }),
      );
      sign.position.set(0, 92, (s * h) / 2 + 0.5);
      if (s < 0) sign.rotation.y = Math.PI;
      g.add(sign);
    }
    g.position.set(wx, 0, wz);
    group.add(g);
    colliders.push(shell);
  }

  // Perimeter barriers at the arena edge (blocked-off street look).
  const barrierMat = lam("#c9c4b2");
  const barrier = (x: number, z: number, rotY: number): void => {
    const g = new THREE.Group();
    const b = box(56, 4, 10, barrierMat, 0, 2, 0);
    const legs = box(50, 6, 2, lam("#b04a3a"), 0, 5, 0);
    legs.rotation.x = 0.5;
    g.add(b, legs);
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    group.add(g);
  };
  for (let i = 0; i < 6; i++) {
    barrier(-700 + i * 250, -442, 0);
    barrier(-700 + i * 250, 442, Math.PI);
  }
  for (let i = 0; i < 3; i++) {
    barrier(-792, -300 + i * 300, Math.PI / 2);
    barrier(792, -300 + i * 300, Math.PI / 2);
  }

  return { meshes: colliders };
}

// ------------------------------------------------------------------- view3d

const TRACER_POOL = 96;

export class View3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private raycaster = new THREE.Raycaster();
  private colliders: THREE.Mesh[] = [];

  /** Camera orbit state. */
  yaw = 0;
  pitch = -0.24;
  private camPos = new THREE.Vector3(0, 162, -102);
  private aimBlend = 0;
  private shakeOff = new THREE.Vector3();

  /** Figures. */
  private playerRig: Rig;
  private botRigs = new Map<number, Rig>();

  /** Pools. */
  private tracers: THREE.Mesh[] = [];
  private tracerTeam: Array<0 | 1> = [];
  private points: THREE.Points;
  private pointPos: Float32Array;
  private pointCol: Float32Array;
  private rings: THREE.Mesh[] = [];
  private ghosts: THREE.Mesh[] = [];
  private flashSprite: THREE.Sprite;
  private flashLife = 0;
  private flashLight: THREE.PointLight;

  /** Floating damage numbers (DOM pool). */
  private floaterLayer: HTMLDivElement;
  private floaters: HTMLSpanElement[] = [];

  /** Screen-center aim point in sim coords. */
  private aimPoint = { x: 1200, y: 450 };

  private disposed = false;
  private tmpV = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Debug hook (harmless in prod; used by dev tooling to inspect the rig).
    (window as unknown as Record<string, unknown>).__vsView = this;

    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 2, 6000);
    this.scene.fog = new THREE.FogExp2(0xd8a46a, 0.00035);
    this.scene.background = new THREE.Color(0x86a0b8);

    // Sky dome: golden-hour gradient.
    const [skyC, skyCtx] = makeCanvas(64, 256);
    const grad = skyCtx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#2c4a6e");
    grad.addColorStop(0.45, "#7c95ad");
    grad.addColorStop(0.72, "#e8b06a");
    grad.addColorStop(0.88, "#f2c883");
    grad.addColorStop(1, "#d8a46a");
    skyCtx.fillStyle = grad;
    skyCtx.fillRect(0, 0, 64, 256);
    const skyTex = new THREE.CanvasTexture(skyC);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(4200, 24, 18),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }),
    );
    this.scene.add(sky);

    // Sun.
    const sun = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture("rgba(255,244,214,1)", "rgba(255,200,120,0.55)"), fog: false, depthWrite: false }),
    );
    sun.scale.set(420, 420, 1);
    sun.position.set(-1300, 950, 700);
    this.scene.add(sun);

    // Lights.
    const hemi = new THREE.HemisphereLight(0xc4d8ea, 0x74604a, 1.15);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffd9a0, 1.9);
    dir.position.set(-900, 1200, 900);
    dir.target.position.set(0, 0, 0);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -1100;
    dir.shadow.camera.right = 1100;
    dir.shadow.camera.top = 900;
    dir.shadow.camera.bottom = -900;
    dir.shadow.camera.near = 100;
    dir.shadow.camera.far = 3600;
    dir.shadow.bias = -0.0006;
    this.scene.add(dir, dir.target);

    const { meshes } = buildCity(this.scene);
    this.colliders = meshes;

    // Figures.
    this.playerRig = buildFigure(P_PLAYER);
    this.scene.add(this.playerRig.root);

    // Tracer pool.
    const tracerGeo = new THREE.BoxGeometry(1.5, 1.5, 1);
    for (let i = 0; i < TRACER_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xc8f31d });
      const m = new THREE.Mesh(tracerGeo, mat);
      m.visible = false;
      this.scene.add(m);
      this.tracers.push(m);
      this.tracerTeam.push(0);
    }

    // Particle pool (512) — matches Effects.MAX_PARTICLES.
    const MAX_P = 512;
    this.pointPos = new Float32Array(MAX_P * 3);
    this.pointCol = new Float32Array(MAX_P * 3);
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(this.pointPos, 3));
    pGeo.setAttribute("color", new THREE.BufferAttribute(this.pointCol, 3));
    this.points = new THREE.Points(
      pGeo,
      new THREE.PointsMaterial({
        size: 5.5,
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    // Ring pool (nova / kill shockwaves).
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.78, 1, 42),
        new THREE.MeshBasicMaterial({ color: 0xff3d5a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.y = 1.5;
      m.visible = false;
      this.scene.add(m);
      this.rings.push(m);
    }

    // Dash ghosts.
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(
        new THREE.CircleGeometry(1, 24),
        new THREE.MeshBasicMaterial({ color: 0xc8f31d, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.y = 1.2;
      m.visible = false;
      this.scene.add(m);
      this.ghosts.push(m);
    }

    // Muzzle flash sprite + light.
    this.flashSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture("rgba(255,250,224,1)", "rgba(228,255,112,0.75)"), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.flashSprite.scale.set(26, 26, 1);
    this.flashSprite.visible = false;
    this.scene.add(this.flashSprite);
    this.flashLight = new THREE.PointLight(0xe4ff70, 0, 320, 1.6);
    this.scene.add(this.flashLight);

    // Floaters layer.
    this.floaterLayer = document.createElement("div");
    this.floaterLayer.className = "pointer-events-none absolute inset-0 overflow-hidden";
    this.floaterLayer.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 40; i++) {
      const s = document.createElement("span");
      s.className = "absolute font-mono text-[12px] font-bold tracking-wider opacity-0";
      s.style.transition = "opacity 80ms linear";
      this.floaterLayer.appendChild(s);
      this.floaters.push(s);
    }
  }

  /** DOM layer that projects floating damage numbers; parent must be relative. */
  get floaterHost(): HTMLDivElement {
    return this.floaterLayer;
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    if (this.disposed) return;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(cssW, cssH, false);
    this.camera.aspect = cssW / Math.max(cssH, 1);
    this.camera.updateProjectionMatrix();
  }

  /** Rotate the camera (mouse look / touch look). Deltas in pixels. */
  look(dx: number, dy: number): void {
    this.yaw -= dx * 0.0034;
    this.pitch = Math.max(-0.62, Math.min(0.32, this.pitch - dy * 0.0022));
  }

  // -------------------------------------------------------------- rendering

  render(world: World, fx: Effects, input: InputManager, dt: number): void {
    if (this.disposed) return;
    const p = world.player;

    // --- figures -----------------------------------------------------------
    poseRig(this.playerRig, p, p.aimX, p.aimY, dt);
    this.playerRig.root.position.set(WX(p.x), 0, WZ(p.y));
    this.playerRig.root.visible = !p.dead || this.playerRig.deadAt < 2.1;
    if (p.dead) poseDead(this.playerRig, dt);

    const seen = new Set<number>();
    for (const b of world.bots) {
      seen.add(b.id);
      let rig = this.botRigs.get(b.id);
      if (!rig) {
        rig = buildFigure(P_BOT);
        this.scene.add(rig.root);
        this.botRigs.set(b.id, rig);
      }
      rig.root.position.set(WX(b.x), 0, WZ(b.y));
      if (b.dead) {
        rig.hpBar.visible = false;
        if (!poseDead(rig, dt)) continue;
        continue;
      }
      let aimX = 0;
      let aimY = 0;
      if (b.state === "ATTACK" || b.state === "CHASE") {
        aimX = p.x - b.x;
        aimY = p.y - b.y;
      } else if (Math.hypot(b.vx, b.vy) > 1) {
        aimX = b.vx;
        aimY = b.vy;
      }
      poseRig(rig, b, aimX, aimY, dt);
      if (b.hp < b.maxHp) {
        rig.hpBar.visible = true;
        const frac = Math.max(0, b.hp / b.maxHp);
        rig.hpBar.scale.set(11 * frac, 1.6, 1);
        (rig.hpBar.material as THREE.SpriteMaterial).opacity = 0.85;
      } else {
        rig.hpBar.visible = false;
      }
    }
    for (const [id, rig] of this.botRigs) {
      if (!seen.has(id)) {
        this.scene.remove(rig.root);
        rig.root.traverse((o) => {
          if (o instanceof THREE.Mesh) o.geometry.dispose();
        });
        this.botRigs.delete(id);
      }
    }

    // --- projectiles (tracers) ---------------------------------------------
    let ti = 0;
    for (const pr of world.projectiles) {
      if (!pr.active || ti >= TRACER_POOL) continue;
      this.drawTracer(pr, ti);
      ti++;
    }
    for (; ti < TRACER_POOL; ti++) this.tracers[ti].visible = false;

    // --- FX ----------------------------------------------------------------
    this.syncParticles(fx);
    this.syncRings(fx);
    this.syncGhosts(fx);
    this.syncFlash(fx);

    // --- camera ------------------------------------------------------------
    this.updateCamera(world, fx, input, dt);

    // --- aim raycast (screen center → chest-height plane) -------------------
    this.updateAim(world, input);

    // --- floaters ----------------------------------------------------------
    this.syncFloaters(fx);

    this.renderer.render(this.scene, this.camera);
  }

  private drawTracer(pr: Projectile, i: number): void {
    const m = this.tracers[i];
    m.visible = true;
    this.tracerTeam[i] = pr.team;
    const mat = m.material as THREE.MeshBasicMaterial;
    mat.color.set(pr.team === 0 ? 0xd6ff45 : 0xff4d68);
    const speed = Math.hypot(pr.vx, pr.vy) || 1;
    const len = Math.max(8, speed * 0.028);
    const cx = WX(pr.x - (pr.vx / speed) * len * 0.5);
    const cz = WZ(pr.y - (pr.vy / speed) * len * 0.5);
    m.position.set(cx, CHEST, cz);
    m.scale.set(1, 1, len);
    m.rotation.y = Math.atan2(pr.vx, pr.vy);
  }

  private syncParticles(fx: Effects): void {
    const colors: Array<[number, number, number]> = [
      [0.91, 0.93, 0.95],
      [0.78, 0.95, 0.11],
      [1.0, 0.24, 0.35],
      [1.0, 0.69, 0.13],
      [0.16, 0.88, 0.53],
    ];
    for (let i = 0; i < fx.particles.length; i++) {
      const pt = fx.particles[i];
      const o = i * 3;
      if (pt.life <= 0) {
        this.pointPos[o + 1] = -9999;
        continue;
      }
      this.pointPos[o] = WX(pt.x);
      this.pointPos[o + 1] = CHEST + (pt.y - pt.x) * 0; // flat plane, slight lift below
      this.pointPos[o + 2] = WZ(pt.y);
      const c = colors[pt.color % colors.length];
      const fade = Math.min(1, pt.life / pt.maxLife);
      this.pointCol[o] = c[0] * fade;
      this.pointCol[o + 1] = c[1] * fade;
      this.pointCol[o + 2] = c[2] * fade;
    }
    const geo = this.points.geometry;
    (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  }

  private syncRings(fx: Effects): void {
    for (let i = 0; i < this.rings.length; i++) {
      const m = this.rings[i];
      if (i >= fx.rings.length || fx.rings[i].life <= 0) {
        m.visible = false;
        continue;
      }
      const r = fx.rings[i];
      m.visible = true;
      m.position.set(WX(r.x), 1.5, WZ(r.y));
      m.scale.set(r.r, r.r, 1);
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity = (r.life / r.maxLife) * 0.75;
      const col = [0xe8ecef, 0xc8f31d, 0xff3d5a, 0xffb020, 0x29e086][r.color % 5];
      mat.color.set(col);
    }
  }

  private syncGhosts(fx: Effects): void {
    for (let i = 0; i < this.ghosts.length; i++) {
      const m = this.ghosts[i];
      if (i >= fx.afterimages.length || fx.afterimages[i].life <= 0) {
        m.visible = false;
        continue;
      }
      const a = fx.afterimages[i];
      m.visible = true;
      m.position.set(WX(a.x), 1.2, WZ(a.y));
      const k = a.life / 0.28;
      const s = 9 + 10 * (1 - k);
      m.scale.set(s, s, 1);
      (m.material as THREE.MeshBasicMaterial).opacity = k * 0.4;
    }
  }

  private syncFlash(fx: Effects): void {
    const fl = fx.flashes[fx.flashes.length - 1];
    if (fl && fl.life > 0) {
      this.flashSprite.visible = true;
      this.flashSprite.position.set(WX(fl.x), CHEST + 2, WZ(fl.y));
      const k = fl.life / fl.maxLife;
      this.flashSprite.scale.set(9 + 11 * k, 9 + 11 * k, 1);
      (this.flashSprite.material as THREE.SpriteMaterial).color.set(
        fl.team === 0 ? 0xf6ffcc : 0xffd2da,
      );
      (this.flashSprite.material as THREE.SpriteMaterial).opacity = Math.min(0.9, k * 1.3);
      this.flashLight.position.copy(this.flashSprite.position);
      this.flashLight.intensity = 140 * k;
      this.flashLight.color.set(fl.team === 0 ? 0xe4ff70 : 0xff8a9a);
      this.flashLife = k;
    } else {
      this.flashSprite.visible = false;
      this.flashLight.intensity = Math.max(0, this.flashLight.intensity - 2400 * 0.016);
    }
  }

  // ------------------------------------------------------------------ camera

  private updateCamera(world: World, fx: Effects, input: InputManager, dt: number): void {
    const p = world.player;
    const head = this.tmpV.set(WX(p.x), HEAD, WZ(p.y));

    // Blend walk ↔ aim camera.
    const aiming = input.fireHeld && !p.dead;
    this.aimBlend += ((aiming ? 1 : 0) - this.aimBlend) * (1 - Math.exp(-10 * dt));
    const blend = this.aimBlend;
    const dist = 132 - blend * 40;
    const height = 54 - blend * 8;
    const shoulder = 8 + blend * 13;
    const basePitch = -0.26 + blend * 0.08;
    const pitch = Math.max(-0.62, Math.min(0.32, basePitch + this.pitch * (1 - blend * 0.4)));
    const fov = 62 - blend * 15;

    const fx2 = Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = Math.sin(this.yaw);

    const dir = new THREE.Vector3(fx2 * Math.cos(pitch), Math.sin(pitch), fz * Math.cos(pitch));
    const desired = head
      .clone()
      .addScaledVector(dir, -dist)
      .add(new THREE.Vector3(rx * shoulder, height, rz * shoulder));

    // Camera collision: pull in front of any building between head and cam.
    const lookDir = desired.clone().sub(head);
    const maxDist = lookDir.length();
    this.raycaster.set(head, lookDir.normalize());
    this.raycaster.far = maxDist;
    let rescued = false;
    const hits = this.raycaster.intersectObjects(this.colliders, false);
    if (hits.length > 0 && hits[0].distance < maxDist) {
      if (hits[0].distance < 48) {
        // The camera would end up inside geometry — rescue: swing around to
        // the FRONT of the player, high up, looking back (GTA-style).
        rescued = true;
        desired.set(head.x + fx2 * 58, head.y + 128, head.z + fz * 58);
      } else {
        desired.copy(head).addScaledVector(lookDir, Math.max(26, hits[0].distance - 8));
      }
    }

    // Death cam: rise and pull out.
    if (world.over) {
      desired.y += 60;
      desired.addScaledVector(dir, -50);
    }

    // Screenshake (world-scaled small).
    this.shakeOff.set(fx.shakeX * 0.35, fx.shakeY * 0.3, 0);
    desired.add(this.shakeOff);

    const k = world.over ? 1 - Math.exp(-2.2 * dt) : 1 - Math.exp(-14 * dt);
    this.camPos.lerp(desired, k);
    this.camera.position.copy(this.camPos);

    const lookAt = rescued ? head.clone() : head.clone().addScaledVector(dir, 60);
    if (world.over) lookAt.copy(head);
    this.camera.lookAt(lookAt);

    if (Math.abs(this.camera.fov - fov) > 0.1) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-8 * dt));
      this.camera.updateProjectionMatrix();
    }

    // Feed yaw back for camera-relative movement.
    input.cameraYaw = this.yaw;
  }

  // --------------------------------------------------------------------- aim

  private updateAim(world: World, input: InputManager): void {
    const p = world.player;
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -CHEST);
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(plane, hit)) {
      this.aimPoint.x = hit.x + 800;
      this.aimPoint.y = hit.z + 450;
    } else {
      // Fallback: camera forward on the floor plane.
      const d = this.camera.getWorldDirection(new THREE.Vector3());
      this.aimPoint.x = p.x + d.x * 600;
      this.aimPoint.y = p.y + d.z * 600;
    }

    // Soft aim assist (mostly for touch): snap to a bot near the crosshair.
    if (input.aimAssist) {
      let best: { d2: number; x: number; y: number } | null = null;
      const fwdX = Math.sin(this.yaw);
      const fwdY = -Math.cos(this.yaw);
      for (const b of world.bots) {
        if (b.dead) continue;
        const dx = b.x - p.x;
        const dy = b.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > 900 * 900) continue;
        const d = Math.sqrt(d2) || 1;
        const cos = (dx / d) * fwdX + (dy / d) * fwdY;
        if (cos < Math.cos(0.24)) continue; // within ~14°
        if (!best || d2 < best.d2) best = { d2, x: b.x, y: b.y };
      }
      if (best) {
        this.aimPoint.x = best.x;
        this.aimPoint.y = best.y;
      }
    }

    input.aimPointX = this.aimPoint.x;
    input.aimPointY = this.aimPoint.y;
  }

  // --------------------------------------------------------------- floaters

  private syncFloaters(fx: Effects): void {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    const colCss = ["#E8ECEF", "#C8F31D", "#FF3D5A", "#FFB020", "#29E086"];
    for (let i = 0; i < this.floaters.length; i++) {
      const el = this.floaters[i];
      const f = fx.floaters[i];
      if (!f || f.life <= 0) {
        el.style.opacity = "0";
        continue;
      }
      this.tmpV.set(WX(f.x), HEAD + 10, WZ(f.y)).project(this.camera);
      if (this.tmpV.z > 1) {
        el.style.opacity = "0";
        continue;
      }
      el.style.left = `${((this.tmpV.x + 1) / 2) * w}px`;
      el.style.top = `${((1 - this.tmpV.y) / 2) * h}px`;
      el.textContent = f.text;
      el.style.color = colCss[f.color % colCss.length];
      el.style.textShadow = "0 1px 2px rgba(0,0,0,0.8)";
      el.style.opacity = String(Math.min(1, (f.life / f.maxLife) * 1.6));
    }
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
        else m.dispose();
      }
    });
  }
}
