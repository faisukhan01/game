/**
 * VOIDSTRIKE — authoritative simulation constants (PROTOCOL.md §2–§3).
 * These literals are law. Do not tune. Do not round. Mirror the C core.
 */

import type { AABB } from "./types";

/** World size (origin top-left, +y down). */
export const WORLD_W = 1600;
export const WORLD_H = 900;

/** Fixed tick rate. dt is a precomputed literal — never recompute. */
export const TICK_RATE = 60;
export const DT = 0.016666666666666666;

/** Static obstacles (AABB: x, y, w, h) — PROTOCOL.md §2. */
export const OBSTACLES: readonly AABB[] = [
  { x: 200, y: 150, w: 220, h: 40 },
  { x: 1180, y: 150, w: 220, h: 40 },
  { x: 200, y: 710, w: 220, h: 40 },
  { x: 700, y: 420, w: 200, h: 60 },
  { x: 1180, y: 710, w: 220, h: 40 },
] as const;

/** Spawn points (8 fixed, edge) — PROTOCOL.md §2. */
export const SPAWN_POINTS: readonly [number, number][] = [
  [80, 80],
  [1520, 80],
  [80, 820],
  [1520, 820],
  [800, 40],
  [800, 860],
  [40, 450],
  [1560, 450],
] as const;

export const PLAYER = {
  radius: 14,
  maxHp: 100,
  speed: 260,
  energyMax: 100,
  energyRegenPerSec: 14,
  dashCooldownSec: 3.0,
  dashImpulse: 720,
} as const;

export const RIFLE = {
  fireIntervalSec: 0.1,
  projectileRadius: 4,
  projectileSpeed: 560,
  damage: 10,
  spreadDeg: 2.0,
  lifetimeSec: 1.2,
  energyCost: 2,
} as const;

export const NOVA = {
  energyCost: 55,
  radius: 210,
  damage: 48,
  knockback: 420,
} as const;

export const BOT = {
  radius: 14,
  damage: 8,
  fireIntervalSec: 0.85,
  projectileSpeed: 480,
  projectileLifetimeSec: 1.6,
  spawnStaggerSec: 0.4,
  /** FSM re-eval cadence, staggered per bot (§7). */
  fsmIntervalSec: 0.25,
  /** PATROL waypoint refresh. */
  patrolIntervalSec: 4.0,
  /** STRAFE orbit speed factor. */
  strafeSpeedFactor: 0.6,
  /** Bot opens fire inside this range with LOS. */
  attackRange: 420,
  /** CHASE trigger distance. */
  chaseRange: 520,
  /** STRAFE trigger distance. */
  strafeRange: 260,
  fleeHpFraction: 0.25,
} as const;

/** Wave n is 1-indexed. */
export const botHpForWave = (n: number): number => Math.min(30 + 8 * n, 90);
export const botSpeedForWave = (n: number): number => Math.min(150 + 6 * n, 240);
export const botAimJitterDegForWave = (n: number): number =>
  Math.max(3.0, 12.0 - 0.5 * n);
export const botCountForWave = (n: number): number => 3 + 2 * n;

export const SCORING = {
  killBase: 100,
  comboWindowSec: 3.0,
  comboMax: 5,
  waveBonusBase: 250,
  waveBonusPerWave: 50,
  survivalPerSec: 1,
} as const;

export const DEG2RAD = Math.PI / 180.0;
