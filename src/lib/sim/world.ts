/**
 * VOIDSTRIKE — deterministic world simulation (PROTOCOL.md §2–§7).
 *
 * PURE MODULE — zero DOM / React / timer dependencies. Given the same seed
 * and the same input stream, step() produces bit-identical state evolution:
 *
 *  - fixed dt literal (1/60), float64 only
 *  - allowed math: + - * / sqrt min max abs floor; cos/sin only transcendentals
 *  - single shared splitmix64 stream, consumed in fixed order:
 *      (a) bot AI in ascending entity id (waypoints, strafe sign at entry),
 *      (b) firing jitter/spread in ascending entity id (player id 0 first),
 *      (c) effect jitter: none — all visual FX live in the render layer.
 *
 * Tick order per §5 (strict):
 *   1 timers → 2 movement (player, then bots ascending id) → 3 world resolve
 *   → 4 firing → 5 projectiles → 6 deaths → 7 nova → 8 regen
 *   → 9 survival score → 10 waves → 11 checksum
 */

import {
  BOT,
  DT,
  OBSTACLES,
  PLAYER,
  RIFLE,
  NOVA,
  SCORING,
  SPAWN_POINTS,
  WORLD_H,
  WORLD_W,
  botAimJitterDegForWave,
  botCountForWave,
  botHpForWave,
  botSpeedForWave,
  DEG2RAD,
} from "./constants";
import { fnv1a64Hex } from "./hash";
import { nearestObstacleCorner, segmentIntersectsAABB } from "./los";
import { SplitMix64 } from "./rng";
import type {
  BotEntity,
  Fighter,
  MatchStats,
  PendingSpawn,
  PlayerEntity,
  Projectile,
  SimEvent,
  SimInput,
} from "./types";

const COMBO_WINDOW = SCORING.comboWindowSec;
const STEP_LERP = 0.2; // §5.2 velocity lerp factor (fixed, per tick)

function quantize(n: number): string {
  // Checksum canonical form: 3 decimals, stable across implementations.
  return n.toFixed(3);
}

/** Rotate (x, y) by angle a using the protocol rotation formula. */
function rotate(x: number, y: number, a: number): { x: number; y: number } {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: x * c - y * s, y: x * s + y * c };
}

export class World {
  readonly seed: number;

  tick = 0;
  elapsed = 0;
  over = false;

  wave = 1;
  score = 0;
  kills = 0;
  combo = 1;
  comboTimer = 0;
  bestCombo = 1;

  player: PlayerEntity;

  /** Active bots in ascending id order (insertion order). */
  bots: BotEntity[] = [];
  /** Projectile pool — fixed objects flagged active; iterate in id order. */
  projectiles: Projectile[] = [];
  private projFree: Projectile[] = [];

  private events: SimEvent[] = [];
  private rng: SplitMix64;
  private pendingSpawns: PendingSpawn[] = [];
  private nextSurvivalSec = 1;
  private nextId = 1;
  private lastChecksum = "0x0";

  constructor(seed: number) {
    this.seed = seed;
    this.rng = new SplitMix64(seed);
    this.player = {
      id: 0,
      x: WORLD_W / 2,
      y: WORLD_H / 2,
      vx: 0,
      vy: 0,
      radius: PLAYER.radius,
      hp: PLAYER.maxHp,
      maxHp: PLAYER.maxHp,
      speed: PLAYER.speed,
      fireCd: 0,
      dead: false,
      energy: PLAYER.energyMax,
      dashCd: 0,
      aimX: 1,
      aimY: 0,
    };
    this.queueWave(1);
  }

  // ------------------------------------------------------------------ waves

  private queueWave(n: number): void {
    this.wave = n;
    const count = botCountForWave(n);
    for (let i = 0; i < count; i++) {
      this.pendingSpawns.push({
        t: i * BOT.spawnStaggerSec,
        idx: i,
        waveIndex: i,
      });
    }
    this.events.push({ kind: "wave", wave: n, count });
  }

  private spawnBot(p: PendingSpawn): void {
    const sp = SPAWN_POINTS[p.idx % SPAWN_POINTS.length];
    const hp = botHpForWave(this.wave);
    const bot: BotEntity = {
      id: this.nextId++,
      x: sp[0],
      y: sp[1],
      vx: 0,
      vy: 0,
      radius: BOT.radius,
      hp,
      maxHp: hp,
      speed: botSpeedForWave(this.wave),
      fireCd: BOT.fireIntervalSec,
      dead: false,
      waveN: this.wave,
      state: "PATROL",
      fsmTimer: (p.waveIndex * BOT.fsmIntervalSec) / botCountForWave(this.wave),
      patrolTimer: 0,
      waypointX: 0,
      waypointY: 0,
      orbitSign: 1,
      fleeX: sp[0],
      fleeY: sp[1],
    };
    this.pickWaypoint(bot); // consumes RNG at spawn — deterministic
    this.bots.push(bot);
  }

  private anyAliveBot(): boolean {
    for (let i = 0; i < this.bots.length; i++) {
      if (!this.bots[i].dead) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------- step

  step(input: SimInput): void {
    if (this.over) return;
    this.tick++;

    // 1 ── timers
    this.elapsed += DT;
    while (this.elapsed >= this.nextSurvivalSec) {
      this.score += SCORING.survivalPerSec;
      this.nextSurvivalSec += 1;
    }
    if (this.comboTimer > 0) {
      this.comboTimer -= DT;
      if (this.comboTimer <= 0) this.combo = 1;
    }
    const p = this.player;
    if (p.dashCd > 0) p.dashCd -= DT;
    if (p.fireCd > 0) p.fireCd -= DT;
    for (let i = 0; i < this.bots.length; i++) {
      const b = this.bots[i];
      if (b.dead) continue;
      if (b.fireCd > 0) b.fireCd -= DT;
      b.fsmTimer -= DT;
      if (b.state === "PATROL") {
        b.patrolTimer -= DT;
        if (b.patrolTimer <= 0) this.pickWaypoint(b);
      }
    }
    for (let i = this.pendingSpawns.length - 1; i >= 0; i--) {
      const s = this.pendingSpawns[i];
      s.t -= DT;
      if (s.t <= 0) {
        this.spawnBot(s);
        this.pendingSpawns.splice(i, 1);
      }
    }

    // 2 ── movement: player first, then bots ascending id
    this.stepPlayerMovement(input);
    for (let i = 0; i < this.bots.length; i++) {
      const b = this.bots[i];
      if (b.dead) continue;
      this.stepBotAI(b);
    }

    // 3 ── world resolve (circle-vs-AABB push-out + bounds)
    this.resolveEntity(p);
    for (let i = 0; i < this.bots.length; i++) {
      if (!this.bots[i].dead) this.resolveEntity(this.bots[i]);
    }

    // 4 ── firing (ascending entity id: player 0, then bots)
    this.stepPlayerFire(input);
    for (let i = 0; i < this.bots.length; i++) {
      const b = this.bots[i];
      if (!b.dead) this.stepBotFire(b);
    }

    // 5 ── projectiles (ascending id)
    this.stepProjectiles();

    // 6 ── deaths (ascending id)
    for (let i = 0; i < this.bots.length; i++) {
      const b = this.bots[i];
      if (b.dead || b.hp > 0) continue;
      b.dead = true;
      this.kills++;
      const gained = SCORING.killBase * this.combo;
      this.score += gained;
      this.combo = Math.min(this.combo + 1, SCORING.comboMax);
      if (this.combo > this.bestCombo) this.bestCombo = this.combo;
      this.comboTimer = COMBO_WINDOW;
      this.events.push({
        kind: "kill",
        x: b.x,
        y: b.y,
        gained,
        combo: this.combo,
      });
    }
    if (p.hp <= 0) {
      p.dead = true;
      this.over = true;
      this.events.push({ kind: "match_end", x: p.x, y: p.y });
    }

    // 7 ── nova
    if (input.nova && p.energy >= NOVA.energyCost) {
      p.energy -= NOVA.energyCost;
      this.events.push({ kind: "nova", x: p.x, y: p.y });
      for (let i = 0; i < this.bots.length; i++) {
        const b = this.bots[i];
        if (b.dead) continue;
        const dx = b.x - p.x;
        const dy = b.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= NOVA.radius * NOVA.radius) {
          b.hp -= NOVA.damage;
          if (d2 > 0) {
            const d = Math.sqrt(d2);
            b.vx += (dx / d) * NOVA.knockback;
            b.vy += (dy / d) * NOVA.knockback;
          }
        }
      }
    }

    // 8 ── regen
    p.energy = Math.min(PLAYER.energyMax, p.energy + PLAYER.energyRegenPerSec * DT);

    // 10 ── waves: next wave when every bot of wave n is dead (§5.10)
    if (this.pendingSpawns.length === 0 && !this.anyAliveBot()) {
      const bonus = SCORING.waveBonusBase + SCORING.waveBonusPerWave * this.wave;
      this.score += bonus;
      this.events.push({
        kind: "wave_clear",
        wave: this.wave,
        gained: bonus,
      });
      this.queueWave(this.wave + 1);
    }

    // 11 ── checksum
    this.lastChecksum = this.computeChecksum();
  }

  // --------------------------------------------------------------- movement

  private stepPlayerMovement(input: SimInput): void {
    const p = this.player;

    // Normalize + clamp aim (client may send any magnitude).
    let ax = input.aimX;
    let ay = input.aimY;
    const al2 = ax * ax + ay * ay;
    if (al2 > 1e-12) {
      const al = Math.sqrt(al2);
      p.aimX = ax / al;
      p.aimY = ay / al;
    }

    let mx = input.moveX;
    let my = input.moveY;
    const ml2 = mx * mx + my * my;
    if (ml2 > 1) {
      const ml = Math.sqrt(ml2);
      mx /= ml;
      my /= ml;
    }

    const tx = mx * p.speed;
    const ty = my * p.speed;
    p.vx += (tx - p.vx) * STEP_LERP;
    p.vy += (ty - p.vy) * STEP_LERP;

    if (input.dash && p.dashCd <= 0) {
      // Dash along move dir if moving, else along aim (§3 dash_impulse).
      let dx = mx;
      let dy = my;
      if (dx * dx + dy * dy < 1e-12) {
        dx = p.aimX;
        dy = p.aimY;
      }
      p.vx += dx * PLAYER.dashImpulse;
      p.vy += dy * PLAYER.dashImpulse;
      p.dashCd = PLAYER.dashCooldownSec;
      this.events.push({ kind: "dash", x: p.x, y: p.y, dirX: dx, dirY: dy });
    }

    p.x += p.vx * DT;
    p.y += p.vy * DT;
  }

  private stepBotAI(b: BotEntity): void {
    const p = this.player;

    // FSM re-evaluation, staggered per bot (§7).
    if (b.fsmTimer <= 0) {
      this.reevaluateBot(b);
      b.fsmTimer = BOT.fsmIntervalSec;
    }

    let dx = 0;
    let dy = 0;
    let spd = b.speed;

    switch (b.state) {
      case "PATROL": {
        dx = b.waypointX - b.x;
        dy = b.waypointY - b.y;
        break;
      }
      case "CHASE": {
        dx = p.x - b.x;
        dy = p.y - b.y;
        break;
      }
      case "STRAFE": {
        // Orbit player at 0.6 × speed; orbit sign fixed at state entry.
        const tx = p.x - b.x;
        const ty = p.y - b.y;
        dx = -ty * b.orbitSign;
        dy = tx * b.orbitSign;
        spd = b.speed * BOT.strafeSpeedFactor;
        break;
      }
      case "ATTACK":
        dx = 0;
        dy = 0;
        break;
      case "FLEE": {
        dx = b.fleeX - b.x;
        dy = b.fleeY - b.y;
        break;
      }
    }

    const l2 = dx * dx + dy * dy;
    let ix = 0;
    let iy = 0;
    if (l2 > 1e-12) {
      const l = Math.sqrt(l2);
      ix = dx / l;
      iy = dy / l;
    }

    const tx = ix * spd;
    const ty = iy * spd;
    b.vx += (tx - b.vx) * STEP_LERP;
    b.vy += (ty - b.vy) * STEP_LERP;
    b.x += b.vx * DT;
    b.y += b.vy * DT;
  }

  private reevaluateBot(b: BotEntity): void {
    const p = this.player;
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const prev = b.state;
    let next: BotEntity["state"];

    if (b.hp < b.maxHp * BOT.fleeHpFraction) {
      next = "FLEE";
      const corner = nearestObstacleCorner(b.x, b.y, OBSTACLES);
      b.fleeX = corner.x;
      b.fleeY = corner.y;
    } else if (d < BOT.strafeRange) {
      next = "STRAFE";
    } else if (
      d < BOT.attackRange &&
      this.losClear(b.x, b.y, p.x, p.y)
    ) {
      next = "ATTACK";
    } else if (d < BOT.chaseRange) {
      next = "CHASE";
    } else {
      next = "PATROL";
    }

    if (next === "STRAFE" && prev !== "STRAFE") {
      // Orbit sign drawn from the shared stream at state entry (§7).
      b.orbitSign = this.rng.uniform01() < 0.5 ? -1 : 1;
    }
    if (next === "PATROL" && prev !== "PATROL") {
      this.pickWaypoint(b);
    }
    b.state = next;
  }

  private pickWaypoint(b: BotEntity): void {
    // Random waypoint from the shared stream (§7 PATROL).
    b.waypointX = this.rng.uniform01() * WORLD_W;
    b.waypointY = this.rng.uniform01() * WORLD_H;
    b.patrolTimer = BOT.patrolIntervalSec;
  }

  private losClear(x0: number, y0: number, x1: number, y1: number): boolean {
    for (let i = 0; i < OBSTACLES.length; i++) {
      if (segmentIntersectsAABB(x0, y0, x1, y1, OBSTACLES[i])) return false;
    }
    return true;
  }

  // ----------------------------------------------------------------- resolve

  private resolveEntity(e: Fighter): void {
    const r = e.radius;
    for (let i = 0; i < OBSTACLES.length; i++) {
      const b = OBSTACLES[i];
      const cx = Math.min(Math.max(e.x, b.x), b.x + b.w);
      const cy = Math.min(Math.max(e.y, b.y), b.y + b.h);
      const dx = e.x - cx;
      const dy = e.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      if (d2 > 1e-12) {
        const d = Math.sqrt(d2);
        const push = r - d;
        e.x += (dx / d) * push;
        e.y += (dy / d) * push;
      } else {
        // Center inside the box: push to nearest edge, zero that axis vel.
        const left = e.x - b.x;
        const right = b.x + b.w - e.x;
        const top = e.y - b.y;
        const bottom = b.y + b.h - e.y;
        const m = Math.min(left, right, top, bottom);
        if (m === left) {
          e.x = b.x - r;
          e.vx = 0;
        } else if (m === right) {
          e.x = b.x + b.w + r;
          e.vx = 0;
        } else if (m === top) {
          e.y = b.y - r;
          e.vy = 0;
        } else {
          e.y = b.y + b.h + r;
          e.vy = 0;
        }
      }
    }
    // World bounds.
    if (e.x < r) {
      e.x = r;
      if (e.vx < 0) e.vx = 0;
    } else if (e.x > WORLD_W - r) {
      e.x = WORLD_W - r;
      if (e.vx > 0) e.vx = 0;
    }
    if (e.y < r) {
      e.y = r;
      if (e.vy < 0) e.vy = 0;
    } else if (e.y > WORLD_H - r) {
      e.y = WORLD_H - r;
      if (e.vy > 0) e.vy = 0;
    }
  }

  // ------------------------------------------------------------------ firing

  private spawnProjectile(
    x: number,
    y: number,
    dirX: number,
    dirY: number,
    speed: number,
    radius: number,
    team: 0 | 1,
    life: number,
    damage: number,
  ): void {
    // Pool: reused objects already live in this.projectiles (inactive);
    // only allocate when the free list is empty. Array order = id order.
    const pr =
      this.projFree.length > 0
        ? this.projFree.pop()
        : (() => {
            const fresh: Projectile = {
              id: 0,
              x: 0,
              y: 0,
              vx: 0,
              vy: 0,
              radius: 0,
              team: 0,
              life: 0,
              active: false,
              damage: 0,
            };
            this.projectiles.push(fresh);
            return fresh;
          })();
    pr.id = this.nextId++;
    pr.x = x;
    pr.y = y;
    pr.vx = dirX * speed;
    pr.vy = dirY * speed;
    pr.radius = radius;
    pr.team = team;
    pr.life = life;
    pr.damage = damage;
    pr.active = true;
    this.projectiles.push(pr);
  }

  private stepPlayerFire(input: SimInput): void {
    const p = this.player;
    if (!input.fire || p.fireCd > 0 || p.energy < RIFLE.energyCost) return;

    // Symmetric uniform spread ±2° from the shared stream (§3).
    const spread =
      (this.rng.uniform01() * 2 - 1) * RIFLE.spreadDeg * DEG2RAD;
    const dir = rotate(p.aimX, p.aimY, spread);
    p.energy -= RIFLE.energyCost;
    p.fireCd = RIFLE.fireIntervalSec;
    const off = p.radius + 6;
    this.spawnProjectile(
      p.x + dir.x * off,
      p.y + dir.y * off,
      dir.x,
      dir.y,
      RIFLE.projectileSpeed,
      RIFLE.projectileRadius,
      0,
      RIFLE.lifetimeSec,
      RIFLE.damage,
    );
    this.events.push({
      kind: "shot",
      x: p.x + dir.x * off,
      y: p.y + dir.y * off,
      dirX: dir.x,
      dirY: dir.y,
      team: 0,
    });
  }

  private stepBotFire(b: BotEntity): void {
    const p = this.player;
    if (b.fireCd > 0) return;
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > BOT.attackRange * BOT.attackRange) return;
    if (!this.losClear(b.x, b.y, p.x, p.y)) return;

    const d = Math.sqrt(d2);
    let ux = dx / d;
    let uy = dy / d;
    const jitter =
      (this.rng.uniform01() * 2 - 1) * botAimJitterDegForWave(b.waveN) * DEG2RAD;
    const dir = rotate(ux, uy, jitter);
    ux = dir.x;
    uy = dir.y;
    b.fireCd = BOT.fireIntervalSec;
    const off = b.radius + 6;
    this.spawnProjectile(
      b.x + ux * off,
      b.y + uy * off,
      ux,
      uy,
      BOT.projectileSpeed,
      RIFLE.projectileRadius,
      1,
      BOT.projectileLifetimeSec,
      BOT.damage,
    );
    this.events.push({
      kind: "bot_shot",
      x: b.x + ux * off,
      y: b.y + uy * off,
      dirX: ux,
      dirY: uy,
      team: 1,
    });
  }

  // ------------------------------------------------------------- projectiles

  private stepProjectiles(): void {
    const p = this.player;
    for (let i = 0; i < this.projectiles.length; i++) {
      const pr = this.projectiles[i];
      if (!pr.active) continue;

      pr.x += pr.vx * DT;
      pr.y += pr.vy * DT;
      pr.life -= DT;

      let despawn = false;

      if (pr.life <= 0) {
        despawn = true;
      } else if (
        pr.x < 0 ||
        pr.x > WORLD_W ||
        pr.y < 0 ||
        pr.y > WORLD_H
      ) {
        despawn = true;
      } else {
        // Obstacle hit: center-clamp check vs each AABB (§5.5).
        for (let k = 0; k < OBSTACLES.length; k++) {
          const b = OBSTACLES[k];
          const cx = Math.min(Math.max(pr.x, b.x), b.x + b.w);
          const cy = Math.min(Math.max(pr.y, b.y), b.y + b.h);
          const dx = pr.x - cx;
          const dy = pr.y - cy;
          if (dx * dx + dy * dy < pr.radius * pr.radius) {
            despawn = true;
            break;
          }
        }
      }

      if (!despawn) {
        if (pr.team === 0) {
          // Striker rounds hit bots (ascending id).
          for (let k = 0; k < this.bots.length; k++) {
            const b = this.bots[k];
            if (b.dead) continue;
            const dx = pr.x - b.x;
            const dy = pr.y - b.y;
            const rr = pr.radius + b.radius;
            if (dx * dx + dy * dy < rr * rr) {
              b.hp -= pr.damage;
              this.events.push({
                kind: "hit",
                x: pr.x,
                y: pr.y,
                damage: pr.damage,
                team: 0,
              });
              despawn = true;
              break;
            }
          }
        } else if (!p.dead) {
          const dx = pr.x - p.x;
          const dy = pr.y - p.y;
          const rr = pr.radius + p.radius;
          if (dx * dx + dy * dy < rr * rr) {
            p.hp -= pr.damage;
            this.events.push({
              kind: "hit",
              x: pr.x,
              y: pr.y,
              damage: pr.damage,
              team: 1,
            });
            despawn = true;
          }
        }
      }

      if (despawn) {
        pr.active = false;
        this.projFree.push(pr);
      }
    }
  }

  // ------------------------------------------------------------------ output

  drainEvents(): SimEvent[] {
    if (this.events.length === 0) return [];
    const out = this.events;
    this.events = [];
    return out;
  }

  matchStats(): MatchStats {
    return {
      score: this.score,
      kills: this.kills,
      wave: this.wave,
      durationSec: Math.floor(this.elapsed),
      bestCombo: this.bestCombo,
    };
  }

  get checksum(): string {
    return this.lastChecksum;
  }

  /**
   * Canonical state checksum (§5.11): FNV1a64 over a quantized state
   * serialization. Floats are quantized to 3 decimals so C / Go / TS
   * implementations agree byte-for-byte on the hash input.
   */
  private computeChecksum(): string {
    const parts: string[] = [];
    parts.push(`v1|t${this.tick}|w${this.wave}|s${this.score}|c${this.combo}|e${this.elapsed.toFixed(4)}`);
    const p = this.player;
    parts.push(
      `P:${quantize(p.x)},${quantize(p.y)},${quantize(p.hp)},${quantize(p.energy)},${quantize(p.vx)},${quantize(p.vy)}`,
    );
    let botStr = "";
    for (let i = 0; i < this.bots.length; i++) {
      const b = this.bots[i];
      if (b.dead) continue;
      botStr += `${b.id}:${quantize(b.x)},${quantize(b.y)},${quantize(b.hp)},${b.state[0]};`;
    }
    parts.push(`B:${botStr}`);
    let prStr = "";
    for (let i = 0; i < this.projectiles.length; i++) {
      const pr = this.projectiles[i];
      if (!pr.active) continue;
      prStr += `${pr.id}:${quantize(pr.x)},${quantize(pr.y)},${quantize(pr.vx)},${quantize(pr.vy)};`;
    }
    parts.push(`J:${prStr}`);
    return fnv1a64Hex(parts.join("|"));
  }
}
