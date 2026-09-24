/**
 * VOIDSTRIKE — render-side effects: pooled particles, floating damage
 * numbers, rings, dash afterimages, screenshake. Purely cosmetic — the
 * deterministic sim never reads this layer.
 */

import { noteFighterShot } from "./characters";
import type { World } from "@/lib/sim/world";
import type { SimEvent } from "@/lib/sim/types";

export const FX_COLORS = ["#E8ECEF", "#C8F31D", "#FF3D5A", "#FFB020", "#29E086"] as const;
export const COLOR_INK = 0;
export const COLOR_VOLT = 1;
export const COLOR_FLARE = 2;
export const COLOR_AMBER = 3;
export const COLOR_MINT = 4;

const MAX_PARTICLES = 512;
const MAX_FLOATERS = 40;
const MAX_RINGS = 24;
const MAX_AFTERIMAGES = 40;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: number;
}

interface Floater {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  text: string;
  color: number;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  maxR: number;
  life: number;
  maxLife: number;
  color: number;
}

interface Afterimage {
  x: number;
  y: number;
  life: number;
}

export interface MuzzleFlash {
  x: number;
  y: number;
  dx: number;
  dy: number;
  team: 0 | 1;
  life: number;
  maxLife: number;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class Effects {
  particles: Particle[] = [];
  floaters: Floater[] = [];
  rings: Ring[] = [];
  afterimages: Afterimage[] = [];
  flashes: MuzzleFlash[] = [];
  shakeEnabled = true;
  private pHead = 0;
  private fHead = 0;
  private rHead = 0;
  private aHead = 0;

  private dashFxTimer = 0;
  private shakeAmp = 0;
  shakeX = 0;
  shakeY = 0;

  constructor() {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 2, color: 0 });
    }
    for (let i = 0; i < MAX_FLOATERS; i++) {
      this.floaters.push({ x: 0, y: 0, life: 0, maxLife: 1, text: "", color: 0 });
    }
    for (let i = 0; i < MAX_RINGS; i++) {
      this.rings.push({ x: 0, y: 0, r: 0, maxR: 1, life: 0, maxLife: 1, color: 0 });
    }
    for (let i = 0; i < MAX_AFTERIMAGES; i++) {
      this.afterimages.push({ x: 0, y: 0, life: 0 });
    }
  }

  // ------------------------------------------------------------------ spawn

  private spawnParticle(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    size: number,
    color: number,
  ): void {
    const p = this.particles[this.pHead];
    this.pHead = (this.pHead + 1) % MAX_PARTICLES;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.life = life;
    p.maxLife = life;
    p.size = size;
    p.color = color;
  }

  private spawnFloater(x: number, y: number, text: string, color: number): void {
    const f = this.floaters[this.fHead];
    this.fHead = (this.fHead + 1) % MAX_FLOATERS;
    f.x = x;
    f.y = y;
    f.text = text;
    f.color = color;
    f.life = 0.8;
    f.maxLife = 0.8;
  }

  private spawnRing(x: number, y: number, maxR: number, life: number, color: number): void {
    const r = this.rings[this.rHead];
    this.rHead = (this.rHead + 1) % MAX_RINGS;
    r.x = x;
    r.y = y;
    r.r = 6;
    r.maxR = maxR;
    r.life = life;
    r.maxLife = life;
    r.color = color;
  }

  private spawnAfterimage(x: number, y: number): void {
    const a = this.afterimages[this.aHead];
    this.aHead = (this.aHead + 1) % MAX_AFTERIMAGES;
    a.x = x;
    a.y = y;
    a.life = 0.28;
  }

  private spawnFlash(x: number, y: number, dx: number, dy: number, team: 0 | 1): void {
    this.flashes.push({ x, y, dx, dy, team, life: 0.07, maxLife: 0.07 });
    if (this.flashes.length > 16) this.flashes.shift();
  }

  addShake(amp: number): void {
    if (!this.shakeEnabled) return;
    this.shakeAmp = Math.max(this.shakeAmp, amp);
  }

  muzzle(x: number, y: number, dx: number, dy: number, team: 0 | 1): void {
    const color = team === 0 ? COLOR_VOLT : COLOR_FLARE;
    for (let i = 0; i < 3; i++) {
      const spread = rand(-0.45, 0.45);
      const c = Math.cos(spread);
      const s = Math.sin(spread);
      const vx = (dx * c - dy * s) * rand(160, 320);
      const vy = (dx * s + dy * c) * rand(160, 320);
      this.spawnParticle(x, y, vx, vy, rand(0.05, 0.12), 2.5, color);
    }
  }

  sparks(x: number, y: number, count: number, color: number): void {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(60, 260);
      this.spawnParticle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.12, 0.3), 2, color);
    }
  }

  burst(x: number, y: number, color: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(80, 420);
      this.spawnParticle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.25, 0.6), rand(2, 3.5), color);
    }
  }

  // ----------------------------------------------------------------- events

  consumeEvent(e: SimEvent, world: World): void {
    switch (e.kind) {
      case "shot":
        if (e.x !== undefined && e.y !== undefined) {
          this.muzzle(e.x, e.y, e.dirX ?? 1, e.dirY ?? 0, e.team ?? 0);
          this.spawnFlash(e.x, e.y, e.dirX ?? 1, e.dirY ?? 0, e.team ?? 0);
          noteFighterShot(world, e.x, e.y, e.dirX ?? 1, e.dirY ?? 0);
        }
        break;
      case "bot_shot":
        if (e.x !== undefined && e.y !== undefined) {
          this.muzzle(e.x, e.y, e.dirX ?? 1, e.dirY ?? 0, 1);
          this.spawnFlash(e.x, e.y, e.dirX ?? 1, e.dirY ?? 0, 1);
          noteFighterShot(world, e.x, e.y, e.dirX ?? 1, e.dirY ?? 0);
        }
        break;
      case "hit":
        if (e.x !== undefined && e.y !== undefined) {
          if (e.team === 0) {
            this.sparks(e.x, e.y, 6, COLOR_VOLT);
            this.spawnFloater(e.x, e.y - 14, `-${e.damage ?? 10}`, COLOR_INK);
          } else {
            this.sparks(e.x, e.y, 5, COLOR_FLARE);
            this.spawnFloater(e.x, e.y - 14, `-${e.damage ?? 8}`, COLOR_FLARE);
          }
        }
        break;
      case "kill":
        if (e.x !== undefined && e.y !== undefined) {
          this.burst(e.x, e.y, COLOR_FLARE, 14);
          this.burst(e.x, e.y, COLOR_INK, 6);
          this.spawnRing(e.x, e.y, 72, 0.35, COLOR_FLARE);
          this.spawnFloater(e.x, e.y - 20, `+${e.gained ?? 100}`, COLOR_VOLT);
          this.addShake(4.5);
        }
        break;
      case "nova":
        if (e.x !== undefined && e.y !== undefined) {
          this.spawnRing(e.x, e.y, 210, 0.45, COLOR_VOLT);
          this.burst(e.x, e.y, COLOR_VOLT, 22);
          this.addShake(11);
        }
        break;
      case "dash":
        this.dashFxTimer = 0.16;
        break;
      case "wave_clear":
        this.spawnFloater(world.player.x, world.player.y - 30, `WAVE CLEAR +${e.gained ?? 0}`, COLOR_MINT);
        this.spawnRing(world.player.x, world.player.y, 120, 0.5, COLOR_MINT);
        break;
      case "match_end":
        this.burst(world.player.x, world.player.y, COLOR_FLARE, 30);
        this.spawnRing(world.player.x, world.player.y, 140, 0.6, COLOR_FLARE);
        this.addShake(14);
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------- step

  step(dt: number, world: World): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      const drag = 1 - 3.2 * dt;
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = 0; i < MAX_FLOATERS; i++) {
      const f = this.floaters[i];
      if (f.life <= 0) continue;
      f.life -= dt;
      f.y -= 44 * dt;
    }
    for (let i = 0; i < MAX_RINGS; i++) {
      const r = this.rings[i];
      if (r.life <= 0) continue;
      r.life -= dt;
      const t = 1 - r.life / r.maxLife;
      r.r = 6 + (r.maxR - 6) * Math.sqrt(t);
    }
    for (let i = 0; i < MAX_AFTERIMAGES; i++) {
      const a = this.afterimages[i];
      if (a.life <= 0) continue;
      a.life -= dt;
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const fl = this.flashes[i];
      fl.life -= dt;
      if (fl.life <= 0) this.flashes.splice(i, 1);
    }

    // Dash afterimage trail (spawn while the dash window is open).
    if (this.dashFxTimer > 0) {
      this.dashFxTimer -= dt;
      this.spawnAfterimage(world.player.x, world.player.y);
    }

    // Screenshake decay.
    if (this.shakeAmp > 0.01) {
      this.shakeAmp *= Math.exp(-7 * dt);
      this.shakeX = rand(-1, 1) * this.shakeAmp;
      this.shakeY = rand(-1, 1) * this.shakeAmp;
    } else {
      this.shakeAmp = 0;
      this.shakeX = 0;
      this.shakeY = 0;
    }
  }
}
