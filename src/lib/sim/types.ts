/**
 * VOIDSTRIKE — simulation types. Pure data, no DOM deps.
 */

export interface AABB {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type BotState = "PATROL" | "CHASE" | "STRAFE" | "ATTACK" | "FLEE";

export interface Fighter {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hp: number;
  maxHp: number;
  speed: number;
  /** Seconds until this fighter may fire again. */
  fireCd: number;
  dead: boolean;
}

export interface PlayerEntity extends Fighter {
  energy: number;
  dashCd: number;
  aimX: number;
  aimY: number;
}

export interface BotEntity extends Fighter {
  waveN: number;
  state: BotState;
  fsmTimer: number;
  patrolTimer: number;
  waypointX: number;
  waypointY: number;
  orbitSign: number;
  fleeX: number;
  fleeY: number;
}

export interface Projectile {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  /** 0 = striker (player), 1 = hostile (bots). */
  team: 0 | 1;
  life: number;
  active: boolean;
  damage: number;
}

export interface PendingSpawn {
  /** Seconds from now until spawn. */
  t: number;
  /** Index into SPAWN_POINTS (cycled). */
  idx: number;
  /** Position within the wave, for FSM stagger. */
  waveIndex: number;
}

export type SimEventKind =
  | "shot"
  | "bot_shot"
  | "hit"
  | "kill"
  | "nova"
  | "dash"
  | "wave"
  | "wave_clear"
  | "match_end";

export interface SimEvent {
  kind: SimEventKind;
  x?: number;
  y?: number;
  dirX?: number;
  dirY?: number;
  /** 0 striker / 1 hostile — for shot + hit events. */
  team?: 0 | 1;
  damage?: number;
  /** Score gained (kill / wave_clear). */
  gained?: number;
  combo?: number;
  wave?: number;
  count?: number;
}

/** Per-tick input pushed into the sim. Edges are true for exactly one tick. */
export interface SimInput {
  /** Desired move direction, magnitude clamped to 1. */
  moveX: number;
  moveY: number;
  /** Aim direction (world space), normalized by the sim. */
  aimX: number;
  aimY: number;
  fire: boolean;
  dash: boolean;
  nova: boolean;
}

export interface MatchStats {
  score: number;
  kills: number;
  wave: number;
  durationSec: number;
  bestCombo: number;
}
