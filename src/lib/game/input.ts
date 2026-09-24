/**
 * VOIDSTRIKE — input aggregation (keyboard + mouse + twin virtual sticks).
 * Produces per-tick SimInput snapshots; edge actions (dash/nova) are consumed
 * exactly once. No React deps — plain class wired by the game view.
 */

import { WORLD_H, WORLD_W } from "@/lib/sim/constants";

export interface InputFrame {
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  fire: boolean;
  dash: boolean;
  nova: boolean;
}

interface Stick {
  active: boolean;
  x: number;
  y: number;
}

const MOVE_KEYS_POS = new Set(["KeyD", "ArrowRight"]);
const MOVE_KEYS_NEG = new Set(["KeyA", "ArrowLeft"]);
const MOVE_KEYS_UP = new Set(["KeyW", "ArrowUp"]);
const MOVE_KEYS_DOWN = new Set(["KeyS", "ArrowDown"]);
const GAME_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
  "KeyE",
  "KeyP",
  "Escape",
]);

export class InputManager {
  private keys = new Set<string>();
  private detachFns: Array<() => void> = [];

  /** Mouse position in world units; valid when mouseActive. */
  mouseWorldX = WORLD_W / 2;
  mouseWorldY = WORLD_H / 2;
  mouseActive = false;
  fireHeld = false;

  /** Twin virtual sticks (touch). Vectors normalized to length ≤ 1. */
  moveStick: Stick = { active: false, x: 0, y: 0 };
  aimStick: Stick = { active: false, x: 0, y: 0 };

  private dashQueued = false;
  private novaQueued = false;
  private lastAimX = 1;
  private lastAimY = 0;

  /** Invoked on P / Escape (pause toggle). Set by the game view. */
  onPauseToggle: (() => void) | null = null;

  attach(): void {
    if (this.detachFns.length > 0) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === "Space") this.dashQueued = true;
      else if (e.code === "KeyE") this.novaQueued = true;
      else if (e.code === "KeyP" || e.code === "Escape") {
        this.onPauseToggle?.();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      this.keys.delete(e.code);
    };
    const onBlur = () => {
      this.keys.clear();
      this.fireHeld = false;
    };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    this.detachFns = [
      () => window.removeEventListener("keydown", onKeyDown),
      () => window.removeEventListener("keyup", onKeyUp),
      () => window.removeEventListener("blur", onBlur),
    ];
  }

  detach(): void {
    for (const fn of this.detachFns) fn();
    this.detachFns = [];
    this.keys.clear();
  }

  setMouseWorld(x: number, y: number): void {
    this.mouseWorldX = x;
    this.mouseWorldY = y;
    this.mouseActive = true;
  }

  setFireHeld(v: boolean): void {
    this.fireHeld = v;
  }

  queueDash(): void {
    this.dashQueued = true;
  }

  queueNova(): void {
    this.novaQueued = true;
  }

  /** Drop pending edges (used when paused / hidden). */
  clearEdges(): void {
    this.dashQueued = false;
    this.novaQueued = false;
  }

  /** Build the per-tick input frame; edges are consumed on first read. */
  sample(px: number, py: number): InputFrame {
    let mx = 0;
    let my = 0;
    for (const k of this.keys) {
      if (MOVE_KEYS_POS.has(k)) mx += 1;
      else if (MOVE_KEYS_NEG.has(k)) mx -= 1;
      else if (MOVE_KEYS_UP.has(k)) my -= 1;
      else if (MOVE_KEYS_DOWN.has(k)) my += 1;
    }
    if (mx === 0 && my === 0 && this.moveStick.active) {
      mx = this.moveStick.x;
      my = this.moveStick.y;
    }
    const ml = Math.sqrt(mx * mx + my * my);
    if (ml > 1) {
      mx /= ml;
      my /= ml;
    }

    let ax = 0;
    let ay = 0;
    if (this.aimStick.active && this.aimStick.x * this.aimStick.x + this.aimStick.y * this.aimStick.y > 1e-6) {
      ax = this.aimStick.x;
      ay = this.aimStick.y;
    } else if (this.mouseActive) {
      ax = this.mouseWorldX - px;
      ay = this.mouseWorldY - py;
    } else {
      ax = this.lastAimX;
      ay = this.lastAimY;
    }
    const al = Math.sqrt(ax * ax + ay * ay);
    if (al > 1e-6) {
      this.lastAimX = ax / al;
      this.lastAimY = ay / al;
    }

    const dash = this.dashQueued;
    const nova = this.novaQueued;
    this.dashQueued = false;
    this.novaQueued = false;

    return {
      moveX: mx,
      moveY: my,
      aimX: this.lastAimX,
      aimY: this.lastAimY,
      fire: this.fireHeld || this.aimStick.active,
      dash,
      nova,
    };
  }
}
