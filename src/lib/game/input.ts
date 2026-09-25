/**
 * VOIDSTRIKE — input aggregation (keyboard + mouse look + touch).
 *
 * GTA-style controls: movement is camera-relative (W walks where the
 * camera faces), aiming comes from the 3D view's screen-center raycast
 * (optionally soft-snapped to a nearby hostile for touch), firing is a
 * held state, dash/nova are queued edges. The camera yaw is fed in by
 * the view each frame; this class never owns the camera.
 */

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

  /** Camera yaw (radians) fed in by the 3D view each frame. */
  cameraYaw = 0;
  /** Aim point in sim coords, fed in by the 3D view each frame. */
  aimPointX = 1200;
  aimPointY = 450;
  /** Soft aim-snap for touch play. */
  aimAssist = false;
  fireHeld = false;

  /** Virtual move stick (touch). Vector normalized to length ≤ 1. */
  moveStick: Stick = { active: false, x: 0, y: 0 };

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

  /**
   * Build the per-tick input frame; edges are consumed on first read.
   * Movement is rotated into world space around the camera yaw; aim is
   * the screen-center aim point relative to the player.
   */
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

    // Camera-relative movement: forward = -my along camera forward.
    const yaw = this.cameraYaw;
    const fx = Math.sin(yaw);
    const fy = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const ry = Math.sin(yaw);
    const fwd = -my;
    const wx = fx * fwd + rx * mx;
    const wy = fy * fwd + ry * mx;

    // Aim: screen-center raycast point relative to the player.
    let ax = this.aimPointX - px;
    let ay = this.aimPointY - py;
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
      moveX: wx,
      moveY: wy,
      aimX: this.lastAimX,
      aimY: this.lastAimY,
      fire: this.fireHeld,
      dash,
      nova,
    };
  }
}
