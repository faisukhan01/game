/**
 * VOIDSTRIKE — natural arena environment ("OLD TOWN PARK" theme).
 *
 * The deterministic sim only knows five AABB cover footprints; this module
 * re-skins the presentation as an abandoned park on the edge of a derelict
 * housing society at dusk: dry grass and dirt paths, a cracked road,
 * boundary walls, an abandoned restaurant, market kiosks and a guard cabin
 * built over those same footprints (visual-only — collisions never change).
 *
 * Everything static is baked once into offscreen canvases (sky, skyline,
 * ground scatter, each structure's faces). Only swaying trees, drifting
 * clouds and birds are drawn per-frame. The seeded RNG keeps the arena
 * pixel-identical across reloads.
 */

import { OBSTACLES, WORLD_H, WORLD_W } from "@/lib/sim/constants";
import type { AABB } from "@/lib/sim/types";
import { TILT } from "./characters";

// ------------------------------------------------------------------ helpers

/** Deterministic 32-bit RNG (mulberry32). */
function rng32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  return [c, ctx];
}

/** Floor-space y → ground-canvas local y (the baked ground canvas starts at the horizon). */
function localY(worldY: number): number {
  return worldY * TILT;
}

// ------------------------------------------------------------------- palette

const C = {
  skyTop: "#26201d",
  skyMid: "#6e4a33",
  skyGlow: "#c9894e",
  skySun: "#ffe9bb",
  cloud: "#8a7462",
  skylineFar: "#4a3b31",
  skylineNear: "#332a25",
  grassFar: "#5c5e46",
  grassMid: "#4c5039",
  grassNear: "#3b402d",
  dirt: "#6b5a42",
  dirtLight: "#7d6c52",
  path: "#8a7758",
  road: "#43444a",
  roadEdge: "#5a5b60",
  roadDash: "#9a947e",
  woodDark: "#4a3a2a",
  wood: "#6b5138",
  woodLight: "#836546",
  brick: "#7a4a38",
  brickDark: "#5e382c",
  brickLight: "#8a5a44",
  mortar: "#4a3028",
  plaster: "#b3a489",
  plasterDark: "#8f8270",
  plasterLight: "#c4b69c",
  tin: "#7a8288",
  tinDark: "#5c6368",
  rust: "#7a5c48",
  leaf: "#425632",
  leafLight: "#587441",
  leafDark: "#32421f",
  deadWood: "#4a3e33",
  shadow: "rgba(10,12,8,0.42)",
} as const;

// ------------------------------------------------------------------- layout

/** Screen-space horizon line (top of the floor plane). */
export const ENV_HORIZON = 238;
const GROUND_H = Math.ceil(WORLD_H * TILT); // 522

/** A no-collision scenery prop, depth-sorted with fighters by floor y. */
export interface Decor {
  kind: "tree" | "bush" | "rock";
  x: number;
  y: number; // floor space
  scale: number;
  variant: number;
  dead: boolean;
}

/** Hand-placed props — kept clear of cover footprints and spawn points. */
export const DECOR: readonly Decor[] = [
  { kind: "tree", x: 520, y: 118, scale: 1.06, variant: 0, dead: true },
  { kind: "tree", x: 62, y: 214, scale: 1.0, variant: 1, dead: false },
  { kind: "tree", x: 1516, y: 168, scale: 1.12, variant: 2, dead: false },
  { kind: "tree", x: 622, y: 664, scale: 0.95, variant: 3, dead: false },
  { kind: "tree", x: 1022, y: 636, scale: 1.02, variant: 4, dead: true },
  { kind: "tree", x: 1402, y: 556, scale: 1.1, variant: 5, dead: false },
  { kind: "tree", x: 352, y: 566, scale: 0.92, variant: 6, dead: false },
  { kind: "tree", x: 758, y: 236, scale: 1.0, variant: 7, dead: false },
  { kind: "bush", x: 252, y: 322, scale: 1.0, variant: 0, dead: false },
  { kind: "bush", x: 902, y: 204, scale: 0.9, variant: 1, dead: false },
  { kind: "bush", x: 1448, y: 700, scale: 1.0, variant: 2, dead: false },
  { kind: "bush", x: 552, y: 798, scale: 0.85, variant: 3, dead: false },
  { kind: "bush", x: 1252, y: 306, scale: 1.05, variant: 4, dead: false },
  { kind: "bush", x: 82, y: 622, scale: 0.95, variant: 5, dead: false },
  { kind: "rock", x: 482, y: 424, scale: 1.0, variant: 0, dead: false },
  { kind: "rock", x: 1102, y: 762, scale: 1.1, variant: 1, dead: false },
  { kind: "rock", x: 62, y: 862, scale: 0.9, variant: 2, dead: false },
  { kind: "rock", x: 1556, y: 402, scale: 0.95, variant: 3, dead: false },
  { kind: "rock", x: 872, y: 566, scale: 0.8, variant: 4, dead: false },
] as const;

// -------------------------------------------------------------- baked caches

interface Baked {
  sky: HTMLCanvasElement;
  ground: HTMLCanvasElement;
  structures: HTMLCanvasElement[]; // one per OBSTACLES entry
}
let baked: Baked | null = null;

function getBaked(): Baked {
  if (baked) return baked;
  baked = {
    sky: bakeSky(),
    ground: bakeGround(),
    structures: OBSTACLES.map((_, i) => bakeStructure(i)),
  };
  return baked;
}

// ----------------------------------------------------------------------- sky

function bakeSky(): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(WORLD_W, ENV_HORIZON);
  const W = WORLD_W;
  const H = ENV_HORIZON;

  // Dusk gradient.
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, C.skyTop);
  g.addColorStop(0.45, "#4e3a2e");
  g.addColorStop(0.78, C.skyMid);
  g.addColorStop(1, C.skyGlow);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Low sun with a soft halo.
  const sunX = 1160;
  const sunY = 168;
  const halo = ctx.createRadialGradient(sunX, sunY, 8, sunX, sunY, 190);
  halo.addColorStop(0, "rgba(255,233,187,0.85)");
  halo.addColorStop(0.25, "rgba(240,190,120,0.38)");
  halo.addColorStop(1, "rgba(240,190,120,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(sunX - 200, sunY - 200, 400, 400);
  ctx.fillStyle = C.skySun;
  ctx.beginPath();
  ctx.arc(sunX, sunY, 26, 0, Math.PI * 2);
  ctx.fill();

  const rand = rng32(0xC0FFEE);

  // ---- far skyline: derelict society towers, half-demolished --------------
  const drawBlock = (
    bx: number, bw: number, bh: number, color: string, seed: number,
  ): void => {
    const r = rng32(seed);
    const top = H - bh;
    ctx.fillStyle = color;
    ctx.fillRect(bx, top, bw, bh);
    // Broken roofline — nibble the parapet.
    ctx.fillStyle = C.skyTop;
    let nx = bx;
    while (nx < bx + bw) {
      if (r() < 0.55) {
        const nw = 6 + r() * 16;
        const nd = 4 + r() * 10;
        ctx.fillRect(nx, top, nw, nd);
        nx += nw;
      } else nx += 8 + r() * 20;
    }
    // Water tank on some roofs.
    if (r() < 0.5) {
      const tx = bx + 8 + r() * (bw - 26);
      ctx.fillStyle = color;
      ctx.fillRect(tx, top - 12, 14, 12);
      ctx.fillRect(tx - 2, top - 14, 18, 3);
    }
    // A few faint warm windows (most abandoned, some still lit).
    for (let wy = top + 10; wy < H - 8; wy += 14) {
      for (let wx = bx + 6; wx < bx + bw - 8; wx += 12) {
        const lit = r();
        if (lit < 0.06) ctx.fillStyle = "rgba(255,190,110,0.30)";
        else if (lit < 0.2) ctx.fillStyle = "rgba(0,0,0,0.35)";
        else continue;
        ctx.fillRect(wx, wy, 6, 7);
      }
    }
  };

  // Far band (behind, lighter).
  let x = -20;
  let i = 0;
  while (x < W + 20) {
    const bw = 46 + rand() * 90;
    drawBlock(x, bw, 52 + rand() * 84, C.skylineFar, 0x5157 + i * 97);
    x += bw + 4 + rand() * 26;
    i++;
  }
  // Near band (darker, sparser, taller).
  x = 30;
  i = 0;
  while (x < W + 20) {
    const bw = 60 + rand() * 110;
    drawBlock(x, bw, 30 + rand() * 58, C.skylineNear, 0x9A21 + i * 131);
    x += bw + 30 + rand() * 90;
    i++;
  }

  // Power poles with sagging wires across the horizon.
  const poles = [90, 420, 760, 1080, 1420];
  ctx.strokeStyle = "#241d19";
  ctx.lineWidth = 3;
  for (const px of poles) {
    const ph = 34 + (px % 37);
    ctx.beginPath();
    ctx.moveTo(px, H);
    ctx.lineTo(px, H - ph);
    ctx.moveTo(px - 9, H - ph + 7);
    ctx.lineTo(px + 9, H - ph + 7);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(30,24,20,0.8)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let p = 0; p < poles.length - 1; p++) {
    const x1 = poles[p];
    const x2 = poles[p + 1];
    const y1 = H - (34 + (x1 % 37)) + 7;
    const y2 = H - (34 + (x2 % 37)) + 7;
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo((x1 + x2) / 2, Math.max(y1, y2) + 14, x2, y2);
  }
  ctx.stroke();

  // Dead scrub on the horizon line.
  for (let sx = 0; sx < W; sx += 14) {
    if (rand() < 0.4) continue;
    const h = 3 + rand() * 9;
    ctx.strokeStyle = "rgba(40,32,24,0.7)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(sx, H);
    ctx.lineTo(sx + (rand() - 0.5) * 8, H - h);
    ctx.stroke();
  }
  return c;
}

// -------------------------------------------------------------------- ground

function bakeGround(): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(WORLD_W, GROUND_H);
  const W = WORLD_W;
  const H = GROUND_H;
  const rand = rng32(0x600D13);

  // Dry park grass — slightly darker toward the camera.
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, C.grassFar);
  g.addColorStop(0.4, C.grassMid);
  g.addColorStop(1, C.grassNear);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Large soft tonal patches (mown / dried out areas).
  for (let p = 0; p < 34; p++) {
    const px = rand() * W;
    const py = rand() * H;
    const pr = 60 + rand() * 150;
    const dark = rand() < 0.5;
    const pg = ctx.createRadialGradient(px, py, pr * 0.2, px, py, pr);
    pg.addColorStop(0, dark ? "rgba(38,44,28,0.30)" : "rgba(112,112,72,0.22)");
    pg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.ellipse(px, py, pr, pr * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Dirt worn patches.
  for (let p = 0; p < 22; p++) {
    const px = rand() * W;
    const py = rand() * H;
    const pr = 24 + rand() * 60;
    ctx.fillStyle = "rgba(107,90,66,0.5)";
    ctx.beginPath();
    ctx.ellipse(px, py, pr, pr * 0.5, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(125,108,82,0.35)";
    ctx.beginPath();
    ctx.ellipse(px - pr * 0.15, py - pr * 0.1, pr * 0.6, pr * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Cracked asphalt road band across the lower half.
  const roadTop = localY(540);
  const roadBot = localY(668);
  ctx.fillStyle = C.road;
  ctx.fillRect(0, roadTop, W, roadBot - roadTop);
  // Edge wear.
  ctx.fillStyle = C.roadEdge;
  ctx.fillRect(0, roadTop, W, 4);
  ctx.fillRect(0, roadBot - 4, W, 4);
  ctx.fillStyle = "rgba(76,80,57,0.9)"; // grass creeping over the edges
  for (let ex = 0; ex < W; ex += 10) {
    if (rand() < 0.55) ctx.fillRect(ex, roadTop - 2 - rand() * 3, 5 + rand() * 6, 3);
    if (rand() < 0.55) ctx.fillRect(ex, roadBot - 1 + rand() * 2, 5 + rand() * 6, 3);
  }
  // Faded center dashes.
  ctx.fillStyle = C.roadDash;
  for (let dx = 20; dx < W; dx += 120) {
    ctx.globalAlpha = 0.35 + rand() * 0.3;
    ctx.fillRect(dx, (roadTop + roadBot) / 2 - 3, 52, 5);
  }
  ctx.globalAlpha = 1;
  // Potholes + tar patches + cracks.
  for (let p = 0; p < 16; p++) {
    const px = rand() * W;
    const py = roadTop + 8 + rand() * (roadBot - roadTop - 16);
    ctx.fillStyle = "rgba(24,26,28,0.55)";
    ctx.beginPath();
    ctx.ellipse(px, py, 7 + rand() * 16, 3 + rand() * 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(20,22,24,0.5)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let k = 0; k < 26; k++) {
    let cx = rand() * W;
    let cy = roadTop + rand() * (roadBot - roadTop);
    ctx.moveTo(cx, cy);
    for (let s = 0; s < 4; s++) {
      cx += (rand() - 0.5) * 34;
      cy += (rand() - 0.5) * 12;
      ctx.lineTo(cx, cy);
    }
  }
  ctx.stroke();

  // Dirt footpath: from the road up to the restaurant door, plus a rim path.
  const pathW = 46;
  const drawPath = (x0: number, y0: number, x1: number, y1: number): void => {
    const steps = 22;
    ctx.fillStyle = "rgba(138,119,88,0.85)";
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = x0 + (x1 - x0) * t + Math.sin(t * 5) * 14;
      const py = y0 + (y1 - y0) * t;
      const w = pathW * (0.75 + 0.25 * Math.sin(t * 9));
      ctx.beginPath();
      ctx.ellipse(px, py, w / 2, (w / 2) * TILT * 0.9, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  drawPath(800, roadBot + 6, 800, localY(492)); // road → restaurant front
  drawPath(120, localY(300), 380, localY(320)); // rim path upper-left
  drawPath(1420, localY(320), 1560, localY(350));
  drawPath(240, roadTop - 4, 500, localY(500)); // road → upper park
  // Path pebbles.
  for (let p = 0; p < 90; p++) {
    const t = rand();
    const px = 800 + Math.sin(t * 5) * 14 + (rand() - 0.5) * pathW;
    const py = localY(492) + t * (roadBot + 6 - localY(492));
    ctx.fillStyle = "rgba(160,144,116,0.5)";
    ctx.fillRect(px, py, 2 + rand() * 2, 1.5);
  }

  // Grass tufts — three quick strokes each.
  const tuftColors = ["#5a6440", "#6e7a4a", "#49542f", "#77824e"];
  for (let t = 0; t < 620; t++) {
    const px = rand() * W;
    const py = rand() * H;
    if (py > roadTop - 4 && py < roadBot + 4) continue;
    ctx.strokeStyle = tuftColors[(rand() * tuftColors.length) | 0];
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let b = 0; b < 3; b++) {
      const bx = px + (b - 1) * 2.4;
      ctx.moveTo(bx, py);
      ctx.lineTo(bx + (rand() - 0.5) * 4, py - 4 - rand() * 6);
    }
    ctx.stroke();
  }
  // Fallen leaves / litter dots.
  for (let t = 0; t < 240; t++) {
    const px = rand() * W;
    const py = rand() * H;
    ctx.fillStyle = rand() < 0.5 ? "rgba(138,122,74,0.6)" : "rgba(90,84,52,0.55)";
    ctx.fillRect(px, py, 2.4, 1.6);
  }
  // Small stones.
  for (let t = 0; t < 120; t++) {
    const px = rand() * W;
    const py = rand() * H;
    const s = 1.6 + rand() * 3.4;
    ctx.fillStyle = "#6c675c";
    ctx.beginPath();
    ctx.ellipse(px, py, s, s * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(190,182,166,0.5)";
    ctx.fillRect(px - s * 0.4, py - s * 0.5, s * 0.7, s * 0.3);
  }

  // Arena boundary: weathered concrete curb + short barrier posts.
  ctx.fillStyle = "#57544c";
  ctx.fillRect(0, 0, W, 5); // far curb (horizon edge)
  ctx.fillRect(0, H - 6, W, 6); // near curb
  ctx.fillStyle = "#454239";
  for (let px = 8; px < W; px += 88) {
    ctx.fillRect(px, H - 20, 7, 15); // near posts
    ctx.fillStyle = "#6a675e";
    ctx.fillRect(px + 1, H - 20, 2, 15);
    ctx.fillStyle = "#454239";
  }
  // Chain-link fence hint along the horizon.
  ctx.strokeStyle = "rgba(70,66,60,0.85)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(0, 7);
  ctx.lineTo(W, 7);
  ctx.stroke();
  ctx.strokeStyle = "rgba(90,86,78,0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let px = 0; px < W; px += 10) {
    ctx.moveTo(px, 2);
    ctx.lineTo(px + 6, 9);
    ctx.moveTo(px + 6, 2);
    ctx.lineTo(px, 9);
  }
  ctx.stroke();

  // Corner vignette so the arena edges melt into the frame.
  const vg = ctx.createRadialGradient(W / 2, H * 0.42, H * 0.4, W / 2, H * 0.5, H * 1.05);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(8,10,6,0.34)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  return c;
}

// ------------------------------------------------------- themed structures

/**
 * Visual heights (screen px) of each cover structure. Collision footprints
 * stay exactly the PROTOCOL AABBs — height is presentation only.
 */
const STRUCT_HEIGHTS = [64, 64, 82, 118, 78];

function brickWallFace(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number): void {
  const rand = rng32(seed);
  // Course gradient.
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#6d4234");
  g.addColorStop(1, "#4e2f26");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Broken crown: nibble the top edge.
  const nibbles: number[] = [];
  let nx = 0;
  while (nx < w) {
    nibbles.push(nx);
    nx += 12 + rand() * 22;
  }
  for (const bx of nibbles) {
    const bh = 3 + rand() * 12;
    ctx.fillStyle = "#20160f";
    ctx.fillRect(bx, 0, 6 + rand() * 12, bh);
  }
  // Brick courses.
  const rowH = 11;
  const brickW = 24;
  for (let ry = 0; ry * rowH < h; ry++) {
    const off = (ry % 2) * (brickW / 2);
    for (let bx = -brickW; bx < w; bx += brickW) {
      const tint = rand();
      if (tint < 0.14) continue; // missing brick (hole)
      ctx.fillStyle =
        tint < 0.38 ? C.brickDark : tint < 0.72 ? C.brick : tint < 0.9 ? C.brickLight : "#6a4030";
      ctx.fillRect(bx + off + 1.2, ry * rowH + 1.2, brickW - 2.4, rowH - 2.4);
      if (tint > 0.82) {
        ctx.fillStyle = "rgba(255,220,190,0.12)";
        ctx.fillRect(bx + off + 1.2, ry * rowH + 1.2, brickW - 2.4, 2);
      }
    }
  }
  // Holes revealing dark interior.
  for (let k = 0; k < 4; k++) {
    const hx = rand() * (w - 30) + 8;
    const hy = 8 + rand() * (h - 26);
    ctx.fillStyle = "#170f0b";
    ctx.beginPath();
    ctx.ellipse(hx, hy, 7 + rand() * 9, 5 + rand() * 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Moss + grime at the base.
  const mg = ctx.createLinearGradient(0, h * 0.55, 0, h);
  mg.addColorStop(0, "rgba(60,70,40,0)");
  mg.addColorStop(1, "rgba(52,64,36,0.55)");
  ctx.fillStyle = mg;
  ctx.fillRect(0, h * 0.55, w, h * 0.45);
  for (let k = 0; k < 8; k++) {
    const mx = rand() * w;
    ctx.fillStyle = "rgba(74,86,48,0.5)";
    ctx.beginPath();
    ctx.ellipse(mx, h - 4 - rand() * 10, 6 + rand() * 10, 3 + rand() * 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Painted faded stripe (society boundary marker).
  ctx.fillStyle = "rgba(214,196,150,0.16)";
  ctx.fillRect(0, h * 0.34, w, 7);
}

function restaurantFace(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number): void {
  const rand = rng32(seed);
  // Weathered plaster.
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, C.plasterLight);
  g.addColorStop(0.55, C.plaster);
  g.addColorStop(1, "#93866e");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Stain streaks.
  for (let k = 0; k < 14; k++) {
    const sx = rand() * w;
    ctx.fillStyle = `rgba(70,60,44,${0.08 + rand() * 0.12})`;
    ctx.fillRect(sx, rand() * h * 0.3, 2 + rand() * 6, h * (0.3 + rand() * 0.5));
  }
  // Cracks.
  ctx.strokeStyle = "rgba(60,50,40,0.55)";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  for (let k = 0; k < 5; k++) {
    let cx = rand() * w;
    let cy = rand() * h * 0.4;
    ctx.moveTo(cx, cy);
    for (let s = 0; s < 5; s++) {
      cx += (rand() - 0.5) * 22;
      cy += 8 + rand() * 14;
      ctx.lineTo(cx, cy);
    }
  }
  ctx.stroke();

  const signH = 22;
  const signY = 8;
  // Signboard.
  ctx.fillStyle = "#2e2a26";
  ctx.fillRect(6, signY, w - 12, signH);
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 2;
  ctx.strokeRect(6, signY, w - 12, signH);
  // Dead tube lights along the sign.
  for (let k = 0; k < 6; k++) {
    ctx.fillStyle = "rgba(230,220,190,0.25)";
    ctx.fillRect(14 + k * ((w - 28) / 6), signY - 4, (w - 28) / 6 - 8, 2.5);
  }
  // Faded name.
  ctx.fillStyle = "rgba(216,201,160,0.8)";
  ctx.font = "700 13px 'Courier New', monospace";
  ctx.textAlign = "center";
  ctx.fillText("★ STARLIGHT RESTAURANT ★", w / 2, signY + 15.5);
  ctx.fillStyle = "rgba(40,34,28,0.35)";
  ctx.fillText("★ STARLIGHT RESTAURANT ★", w / 2 + 1, signY + 16.5);

  // Torn striped awning under the sign.
  const awnY = signY + signH + 3;
  const stripeW = 16;
  for (let sx = 6; sx < w - 6; sx += stripeW) {
    const torn = rand();
    ctx.fillStyle = ((sx / stripeW) | 0) % 2 === 0 ? "#9a4a3c" : "#cbb89a";
    if (torn < 0.18) {
      // ripped chunk missing
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx, awnY, stripeW, 12);
      ctx.clip();
      ctx.fillRect(sx, awnY + 4 + rand() * 4, stripeW, 8);
      ctx.restore();
    } else {
      ctx.fillRect(sx, awnY, stripeW, 13);
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fillRect(sx, awnY + 10, stripeW, 3);
    }
  }
  ctx.fillStyle = "rgba(40,30,24,0.35)";
  ctx.fillRect(6, awnY + 13, w - 12, 2.5);

  // Boarded window (left) + shuttered door (right).
  const winX = 20;
  const winY = awnY + 22;
  const winW = 72;
  const winH = 34;
  ctx.fillStyle = "#1c1713";
  ctx.fillRect(winX, winY, winW, winH);
  ctx.strokeStyle = "#54402f";
  ctx.lineWidth = 3;
  ctx.strokeRect(winX, winY, winW, winH);
  for (let p = 0; p < 4; p++) {
    ctx.fillStyle = p % 2 ? "#5e4a38" : "#6d5741";
    ctx.save();
    ctx.translate(winX, winY + 3 + p * 8);
    ctx.rotate((rand() - 0.5) * 0.06);
    ctx.fillRect(0, 0, winW, 6);
    ctx.restore();
  }
  const doorX = w - 66;
  const doorW = 48;
  const doorY = winY - 4;
  const doorH = h - doorY - 6;
  // Rusted roller shutter.
  const sg = ctx.createLinearGradient(doorX, 0, doorX + doorW, 0);
  sg.addColorStop(0, "#6a6e74");
  sg.addColorStop(0.5, "#7d8288");
  sg.addColorStop(1, "#5e6268");
  ctx.fillStyle = sg;
  ctx.fillRect(doorX, doorY, doorW, doorH);
  ctx.strokeStyle = "rgba(40,42,46,0.8)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let ry = doorY + 4; ry < doorY + doorH; ry += 5) {
    ctx.moveTo(doorX, ry);
    ctx.lineTo(doorX + doorW, ry);
  }
  ctx.stroke();
  // Rust streaks on the shutter.
  for (let k = 0; k < 6; k++) {
    ctx.fillStyle = `rgba(122,74,48,${0.25 + rand() * 0.3})`;
    ctx.fillRect(doorX + rand() * doorW, doorY + rand() * doorH * 0.5, 3 + rand() * 5, 8 + rand() * 20);
  }
  // Padlock + handle plate.
  ctx.fillStyle = "#3a3a3c";
  ctx.fillRect(doorX + doorW * 0.5 - 5, doorY + doorH * 0.62, 10, 12);
  // Middle pillar between window and door.
  ctx.fillStyle = "rgba(0,0,0,0.08)";
  ctx.fillRect(winX + winW + 8, winY - 8, 6, h - winY);

  // Base: grime + step slab.
  const bg = ctx.createLinearGradient(0, h * 0.75, 0, h);
  bg.addColorStop(0, "rgba(40,36,28,0)");
  bg.addColorStop(1, "rgba(40,36,28,0.5)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, h * 0.75, w, h * 0.25);
  ctx.fillStyle = "#8f887a";
  ctx.fillRect(8, h - 7, w - 16, 7);
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(8, h - 2.5, w - 16, 2.5);

  // Vandal tags (subtle).
  ctx.strokeStyle = "rgba(160,60,60,0.28)";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(w * 0.42, winY + 6);
  ctx.quadraticCurveTo(w * 0.47, winY - 8, w * 0.53, winY + 4);
  ctx.stroke();
}

function kioskFace(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number): void {
  const rand = rng32(seed);
  // Wooden plank front.
  ctx.fillStyle = C.wood;
  ctx.fillRect(0, 0, w, h);
  const plankH = 12;
  for (let py = 0; py < h; py += plankH) {
    ctx.fillStyle = rand() < 0.5 ? C.wood : rand() < 0.5 ? C.woodLight : "#5f4832";
    ctx.fillRect(0, py, w, plankH - 1.4);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, py + plankH - 1.4, w, 1.4);
    // Knots.
    if (rand() < 0.4) {
      ctx.fillStyle = "rgba(58,44,30,0.7)";
      ctx.beginPath();
      ctx.ellipse(rand() * w, py + plankH / 2, 2.4, 1.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Open counter: dark opening with shelf.
  const cX = w * 0.3;
  const cW = w * 0.4;
  const cY = 14;
  const cH = h - cY - 12;
  ctx.fillStyle = "#181410";
  ctx.fillRect(cX, cY, cW, cH);
  ctx.fillStyle = "#241d16";
  ctx.fillRect(cX - 6, cY + cH * 0.45, cW + 12, 5); // shelf
  // Hanging strips (old plastic curtain).
  for (let sx = cX + 3; sx < cX + cW - 3; sx += 7) {
    ctx.fillStyle = `rgba(150,150,140,${0.16 + rand() * 0.14})`;
    ctx.fillRect(sx, cY, 3, cH * (0.4 + rand() * 0.5));
  }
  // Torn tarp over the right corner.
  ctx.fillStyle = "rgba(138,142,150,0.85)";
  ctx.beginPath();
  ctx.moveTo(w - 46, 8);
  ctx.lineTo(w - 6, 14);
  ctx.lineTo(w - 12, 34 + rand() * 10);
  ctx.lineTo(w - 40, 26);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(70,74,80,0.6)";
  ctx.fillRect(w - 34, 12, 18, 3);
  // Grime + moss base.
  const bg = ctx.createLinearGradient(0, h * 0.7, 0, h);
  bg.addColorStop(0, "rgba(30,30,20,0)");
  bg.addColorStop(1, "rgba(30,34,18,0.5)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, h * 0.7, w, h * 0.3);
  // Crates beside the counter.
  ctx.fillStyle = "#7a5c3a";
  ctx.fillRect(w - 34, h - 20, 22, 18);
  ctx.strokeStyle = "rgba(40,28,16,0.8)";
  ctx.lineWidth = 1.6;
  ctx.strokeRect(w - 34, h - 20, 22, 18);
  ctx.beginPath();
  ctx.moveTo(w - 34, h - 20);
  ctx.lineTo(w - 12, h - 2);
  ctx.moveTo(w - 12, h - 20);
  ctx.lineTo(w - 34, h - 2);
  ctx.stroke();
  ctx.fillStyle = "#6a4e30";
  ctx.fillRect(w - 30, h - 34, 18, 14);
  ctx.strokeRect(w - 30, h - 34, 18, 14);
}

function cabinFace(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number): void {
  const rand = rng32(seed);
  // Aging plaster cabin.
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#9a9282");
  g.addColorStop(1, "#6e675c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Plaster patches falling off → brick underneath.
  for (let k = 0; k < 7; k++) {
    const px = rand() * (w - 26);
    const py = h * 0.3 + rand() * h * 0.55;
    ctx.fillStyle = C.brickDark;
    ctx.fillRect(px, py, 12 + rand() * 22, 8 + rand() * 12);
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 1;
    ctx.strokeRect(px, py, 12 + rand() * 22, 8 + rand() * 12);
  }
  // Broken window with shards.
  const wx = w * 0.22;
  const wy = 12;
  const ww = 52;
  const wh = 30;
  ctx.fillStyle = "#141a1e";
  ctx.fillRect(wx, wy, ww, wh);
  ctx.strokeStyle = "#4a4238";
  ctx.lineWidth = 3;
  ctx.strokeRect(wx, wy, ww, wh);
  ctx.strokeStyle = "rgba(170,200,210,0.4)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let k = 0; k < 5; k++) {
    const sx = wx + 4 + rand() * (ww - 8);
    const sy = wy + 2 + rand() * 8;
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + (rand() - 0.5) * 8, sy + 6 + rand() * 10);
  }
  ctx.stroke();
  // Door.
  ctx.fillStyle = "#4e4438";
  ctx.fillRect(w - 60, wy - 2, 42, h - wy + 2);
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.strokeRect(w - 60, wy - 2, 42, h - wy + 2);
  // Rusted tin roof strip along the top.
  ctx.fillStyle = C.rust;
  ctx.fillRect(0, 0, w, 7);
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(0, 5, w, 2);
  // Barrier pole leaning against the wall.
  ctx.strokeStyle = "#c8c0ae";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(10, h - 2);
  ctx.lineTo(34, 6);
  ctx.stroke();
  ctx.fillStyle = "#b03a30";
  ctx.save();
  ctx.translate(24, 30);
  ctx.rotate(-0.42);
  ctx.fillRect(-2, 0, 4, 9);
  ctx.fillRect(-2, 16, 4, 9);
  ctx.restore();
  // Base grime.
  const bg = ctx.createLinearGradient(0, h * 0.72, 0, h);
  bg.addColorStop(0, "rgba(28,26,20,0)");
  bg.addColorStop(1, "rgba(28,26,20,0.5)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, h * 0.72, w, h * 0.28);
}

function bakeStructure(index: number): HTMLCanvasElement {
  const b = OBSTACLES[index];
  const H = STRUCT_HEIGHTS[index];
  const [c, ctx] = makeCanvas(b.w, H);
  switch (index) {
    case 0:
      brickWallFace(ctx, b.w, H, 0xB100 + 7);
      break;
    case 1:
      brickWallFace(ctx, b.w, H, 0xB200 + 11);
      break;
    case 2:
      kioskFace(ctx, b.w, H, 0xC200 + 3);
      break;
    case 3:
      restaurantFace(ctx, b.w, H, 0xD300 + 5);
      break;
    default:
      cabinFace(ctx, b.w, H, 0xE400 + 9);
  }
  return c;
}

/**
 * Draw the themed cover for OBSTACLES[index]: baked front face + live top
 * face (footprint) + ground shadow. Fully decorative — collisions unchanged.
 */
export function drawStructure(
  ctx: CanvasRenderingContext2D,
  index: number,
  b: AABB,
): void {
  const bk = getBaked();
  const H = STRUCT_HEIGHTS[index];
  const yFar = localY(b.y) + ENV_HORIZON;
  const yNear = localY(b.y + b.h) + ENV_HORIZON;

  // Ground shadow puddle in front.
  ctx.fillStyle = C.shadow;
  ctx.beginPath();
  ctx.ellipse(b.x + b.w / 2, yNear + 5, b.w * 0.55, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  // Front face (baked art).
  ctx.drawImage(bk.structures[index], b.x, yNear - H);

  // Top face — weathered roof/deck between the far and near edges.
  const topH = yNear - yFar;
  const roofG = ctx.createLinearGradient(0, yFar - H, 0, yFar - H + topH);
  if (index === 3) {
    roofG.addColorStop(0, "#77726a");
    roofG.addColorStop(1, "#5d5850");
  } else if (index === 0 || index === 1) {
    roofG.addColorStop(0, "#8a8578");
    roofG.addColorStop(1, "#6e6a5e");
  } else {
    roofG.addColorStop(0, C.tin);
    roofG.addColorStop(1, C.tinDark);
  }
  ctx.fillStyle = roofG;
  ctx.fillRect(b.x, yFar - H, b.w, topH);
  // Roof clutter: gravel speckle + vents / broken tiles.
  const rand = rng32(0x71EF + index * 41);
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  for (let k = 0; k < 40; k++) {
    ctx.fillRect(b.x + rand() * b.w, yFar - H + rand() * topH, 2, 1.4);
  }
  if (index === 3) {
    // Water tank + vent pipe on the restaurant roof.
    ctx.fillStyle = "#3c4044";
    ctx.fillRect(b.x + 12, yFar - H - 9, 22, 11);
    ctx.fillStyle = "#565b60";
    ctx.fillRect(b.x + 12, yFar - H - 11, 22, 3);
    ctx.strokeStyle = "#4a4e52";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(b.x + b.w - 30, yFar - H);
    ctx.lineTo(b.x + b.w - 30, yFar - H - 14);
    ctx.stroke();
    // Parapet edge.
    ctx.fillStyle = "#8a8478";
    ctx.fillRect(b.x, yFar - H + topH - 3, b.w, 3);
  } else if (index >= 2) {
    // Corrugated ribs on the tin roofs.
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let rx = b.x + 6; rx < b.x + b.w; rx += 9) {
      ctx.moveTo(rx, yFar - H);
      ctx.lineTo(rx, yFar - H + topH);
    }
    ctx.stroke();
  } else {
    // Rubble along the wall top.
    for (let k = 0; k < 12; k++) {
      ctx.fillStyle = rand() < 0.5 ? "#6a4030" : "#7c4a38";
      const rx = b.x + rand() * b.w;
      ctx.fillRect(rx, yFar - H - 2 - rand() * 4, 4 + rand() * 5, 3 + rand() * 3);
    }
  }
  // Rebar on the broken brick walls.
  if (index <= 1) {
    ctx.strokeStyle = "#3a2c22";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let k = 0; k < 5; k++) {
      const rx = b.x + 20 + rand() * (b.w - 40);
      const rh = 6 + rand() * 10;
      ctx.moveTo(rx, yFar - H);
      ctx.lineTo(rx + 2, yFar - H - rh);
    }
    ctx.stroke();
  }
  // Outline for readability.
  ctx.strokeStyle = "rgba(15,12,10,0.55)";
  ctx.lineWidth = 1.4;
  ctx.strokeRect(b.x, yFar - H, b.w, topH + H);
}

// ------------------------------------------------------------------- scenery

function drawTree(ctx: CanvasRenderingContext2D, d: Decor, t: number): void {
  const ax = d.x;
  const ay = ENV_HORIZON + localY(d.y);
  const S = 52 * d.scale;
  const sway = Math.sin(t * 1.1 + d.variant * 1.7) * 0.028 + Math.sin(t * 2.3 + d.variant) * 0.012;

  // Shadow.
  ctx.fillStyle = "rgba(10,12,8,0.4)";
  ctx.beginPath();
  ctx.ellipse(ax + 6, ay + 3, S * 0.55, S * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();

  const lean = sway * S;
  if (d.dead) {
    // Bare dead tree — recursive-ish branches.
    ctx.strokeStyle = C.deadWood;
    ctx.lineCap = "round";
    ctx.lineWidth = S * 0.09;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    const topX = ax + lean;
    const topY = ay - S * 1.75;
    ctx.quadraticCurveTo(ax + S * 0.06, ay - S * 0.9, topX, topY);
    ctx.stroke();
    const branch = (
      x0: number, y0: number, ang: number, len: number, w: number, depth: number,
    ): void => {
      if (depth === 0 || len < 4) return;
      const x1 = x0 + Math.cos(ang) * len;
      const y1 = y0 + Math.sin(ang) * len;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      branch(x1, y1, ang - 0.42 - sway * 0.4, len * 0.68, w * 0.6, depth - 1);
      branch(x1, y1, ang + 0.38 + sway * 0.4, len * 0.66, w * 0.6, depth - 1);
    };
    const tipX = ax + lean;
    const tipY = ay - S * 1.75;
    branch(tipX, tipY + S * 0.35, -Math.PI / 2 - 0.65 + sway, S * 0.5, S * 0.06, 3);
    branch(tipX, tipY + S * 0.55, -Math.PI / 2 + 0.6 + sway, S * 0.55, S * 0.07, 3);
    branch(tipX, tipY + S * 0.15, -Math.PI / 2 + 0.18 + sway * 0.5, S * 0.4, S * 0.05, 2);
    return;
  }

  // Living tree: trunk + layered canopy blobs.
  ctx.strokeStyle = "#3e332a";
  ctx.lineCap = "round";
  ctx.lineWidth = S * 0.13;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.quadraticCurveTo(ax + S * 0.05, ay - S * 0.8, ax + lean, ay - S * 1.35);
  ctx.stroke();
  // Branch stubs.
  ctx.lineWidth = S * 0.06;
  ctx.beginPath();
  ctx.moveTo(ax + S * 0.02, ay - S * 0.85);
  ctx.lineTo(ax - S * 0.34 + lean * 0.6, ay - S * 1.15);
  ctx.moveTo(ax + S * 0.03, ay - S * 1.0);
  ctx.lineTo(ax + S * 0.38 + lean * 0.6, ay - S * 1.28);
  ctx.stroke();

  const cy = ay - S * 1.62;
  const cx = ax + lean * 1.6;
  const blobs: [number, number, number][] = [
    [0, 0, 0.62],
    [-0.42, 0.16, 0.44],
    [0.44, 0.12, 0.46],
    [-0.18, -0.3, 0.4],
    [0.24, -0.26, 0.38],
  ];
  for (const [ox, oy, r] of blobs) {
    ctx.fillStyle = C.leafDark;
    ctx.beginPath();
    ctx.ellipse(cx + ox * S, cy + oy * S, r * S, r * S * 0.86, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const [ox, oy, r] of blobs) {
    ctx.fillStyle = C.leaf;
    ctx.beginPath();
    ctx.ellipse(cx + ox * S - 1.5, cy + oy * S - 2.5, r * S * 0.9, r * S * 0.76, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Sun-side highlights.
  for (const [ox, oy, r] of blobs) {
    ctx.fillStyle = C.leafLight;
    ctx.beginPath();
    ctx.ellipse(cx + ox * S + r * S * 0.24, cy + oy * S - r * S * 0.3, r * S * 0.42, r * S * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBush(ctx: CanvasRenderingContext2D, d: Decor, t: number): void {
  const ax = d.x;
  const ay = ENV_HORIZON + localY(d.y);
  const S = 20 * d.scale;
  const sway = Math.sin(t * 1.6 + d.variant * 2.1) * 0.05;

  ctx.fillStyle = "rgba(10,12,8,0.35)";
  ctx.beginPath();
  ctx.ellipse(ax, ay + 2, S * 1.1, S * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();

  const blobs: [number, number, number][] = [
    [-0.6, -0.2, 0.62],
    [0.55, -0.15, 0.58],
    [0, -0.5, 0.66],
  ];
  for (const [ox, oy, r] of blobs) {
    ctx.fillStyle = C.leafDark;
    ctx.beginPath();
    ctx.ellipse(ax + ox * S * (1 + sway), ay - oy * S, r * S, r * S * 0.78, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const [ox, oy, r] of blobs) {
    ctx.fillStyle = C.leaf;
    ctx.beginPath();
    ctx.ellipse(ax + ox * S * (1 + sway) - 1, ay - oy * S - 1.5, r * S * 0.82, r * S * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = C.leafLight;
  ctx.beginPath();
  ctx.ellipse(ax + S * 0.18, ay - S * 0.72, S * 0.34, S * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawRock(ctx: CanvasRenderingContext2D, d: Decor): void {
  const ax = d.x;
  const ay = ENV_HORIZON + localY(d.y);
  const S = 9 * d.scale;
  ctx.fillStyle = "rgba(10,12,8,0.35)";
  ctx.beginPath();
  ctx.ellipse(ax + 1, ay + 1.5, S * 1.15, S * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#6c675c";
  ctx.beginPath();
  ctx.moveTo(ax - S, ay);
  ctx.lineTo(ax - S * 0.6, ay - S * 0.85);
  ctx.lineTo(ax + S * 0.2, ay - S);
  ctx.lineTo(ax + S, ay - S * 0.35);
  ctx.lineTo(ax + S * 0.9, ay);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#847e70";
  ctx.beginPath();
  ctx.moveTo(ax - S * 0.6, ay - S * 0.85);
  ctx.lineTo(ax + S * 0.2, ay - S);
  ctx.lineTo(ax + S * 0.3, ay - S * 0.5);
  ctx.closePath();
  ctx.fill();
}

/** Draw one scenery prop (sway animated by t). */
export function drawDecor(ctx: CanvasRenderingContext2D, d: Decor, t: number): void {
  if (d.kind === "tree") drawTree(ctx, d, t);
  else if (d.kind === "bush") drawBush(ctx, d, t);
  else drawRock(ctx, d);
}

// ------------------------------------------------------------------ ambience

interface Cloud {
  x: number;
  y: number;
  s: number;
  v: number;
}
let clouds: Cloud[] | null = null;

function getClouds(): Cloud[] {
  if (clouds) return clouds;
  const rand = rng32(0xC10D);
  clouds = Array.from({ length: 6 }, () => ({
    x: rand() * WORLD_W,
    y: 14 + rand() * 120,
    s: 0.6 + rand() * 1.1,
    v: 4 + rand() * 7,
  }));
  return clouds;
}

function drawCloud(ctx: CanvasRenderingContext2D, c: Cloud, t: number): void {
  const x = ((c.x + t * c.v) % (WORLD_W + 260)) - 130;
  const y = c.y;
  const s = c.s;
  ctx.fillStyle = "rgba(160,138,118,0.14)";
  ctx.beginPath();
  ctx.ellipse(x, y, 60 * s, 14 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 34 * s, y - 8 * s, 40 * s, 12 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(x - 36 * s, y + 3 * s, 34 * s, 10 * s, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawBirds(ctx: CanvasRenderingContext2D, t: number): void {
  ctx.strokeStyle = "rgba(30,24,20,0.7)";
  ctx.lineWidth = 1.6;
  for (let b = 0; b < 5; b++) {
    const bx = ((b * 173 + t * (16 + b * 3)) % (WORLD_W + 140)) - 70;
    const by = 44 + b * 13 + Math.sin(t * 2 + b) * 5;
    const flap = Math.sin(t * 7 + b * 1.9) * 3;
    ctx.beginPath();
    ctx.moveTo(bx - 5, by - flap);
    ctx.quadraticCurveTo(bx, by + 2, bx + 5, by - flap);
    ctx.stroke();
  }
}

// ----------------------------------------------------------------- composite

/** Blit the baked sky; then live clouds + birds. */
export function drawSky(ctx: CanvasRenderingContext2D, t: number): void {
  ctx.drawImage(getBaked().sky, 0, 0);
  for (const c of getClouds()) drawCloud(ctx, c, t);
  drawBirds(ctx, t);
}

/** Blit the baked ground (roads, paths, scatter, curbs). */
export function drawGround(ctx: CanvasRenderingContext2D): void {
  ctx.drawImage(getBaked().ground, 0, ENV_HORIZON);
}
