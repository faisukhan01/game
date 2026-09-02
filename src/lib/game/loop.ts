/**
 * VOIDSTRIKE — game loop. Fixed 60Hz simulation via accumulator inside a
 * rAF frame; rendering and HUD writes are separated from the sim. The loop
 * owns zero React state: HUD numbers are written straight to DOM refs so
 * React never re-renders at frame rate.
 */

import { DT, PLAYER, NOVA, WORLD_H, WORLD_W } from "@/lib/sim/constants";
import type { MatchStats, SimEvent } from "@/lib/sim/types";
import type { World } from "@/lib/sim/world";
import { Effects } from "./effects";
import { drawMinimap, MINIMAP_H, MINIMAP_W } from "./minimap";
import { renderGame } from "./renderer";
import type { SfxEngine } from "./sfx";
import type { InputManager } from "./input";

const STEP_MS = 1000 / 60;
const MAX_STEPS_PER_FRAME = 5;
const DEATH_TO_RESULTS_MS = 1150;

/** DOM nodes the loop writes to directly (no React re-render). */
export interface HudRefs {
  hpFill: HTMLElement | null;
  hpText: HTMLElement | null;
  energyFill: HTMLElement | null;
  score: HTMLElement | null;
  combo: HTMLElement | null;
  wave: HTMLElement | null;
  dashFill: HTMLElement | null;
  novaChip: HTMLElement | null;
  vignette: HTMLElement | null;
  minimap: HTMLCanvasElement | null;
}

/** Events forwarded to React (low frequency only). */
export type UiEventKind = "kill" | "wave" | "wave_clear" | "match_end";

export interface LoopCallbacks {
  onUiEvent: (e: SimEvent) => void;
  onOver: (stats: MatchStats) => void;
}

const SFX_FOR_EVENT: Record<string, string> = {
  shot: "shot",
  hit: "hit",
  kill: "kill",
  nova: "nova",
  dash: "dash",
  match_end: "death",
  wave: "wave",
  wave_clear: "ui",
};

export class GameLoop {
  private raf = 0;
  private last = 0;
  private acc = 0;
  private running = false;
  private overAt = -1;
  private overDispatched = false;
  private lastCombo = 1;
  private frameCount = 0;
  private monoFont = "";
  private minimapCtx: CanvasRenderingContext2D | null = null;
  private scale = 1;
  private dpr = 1;

  paused = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private ctx: CanvasRenderingContext2D,
    private world: World,
    private fx: Effects,
    private sfx: SfxEngine,
    private input: InputManager,
    private hud: HudRefs,
    private cb: LoopCallbacks,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  setScale(scale: number, dpr: number): void {
    this.scale = scale;
    this.dpr = dpr;
  }

  private resolveMonoFont(): string {
    if (this.monoFont) return this.monoFont;
    let fam = "";
    try {
      fam = getComputedStyle(document.documentElement)
        .getPropertyValue("--font-mono")
        .trim();
    } catch {
      fam = "";
    }
    this.monoFont = fam || 'ui-monospace, "JetBrains Mono", monospace';
    return this.monoFont;
  }

  private frame = (t: number): void => {
    if (!this.running) return;

    const dtMs = Math.min(t - this.last, 100);
    this.last = t;

    const active = !this.paused && !this.world.over;
    if (active) {
      this.acc += dtMs;
      let steps = 0;
      while (this.acc >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
        const px = this.world.player.x;
        const py = this.world.player.y;
        this.world.step(this.input.sample(px, py));
        this.acc -= STEP_MS;
        steps++;
      }
      if (steps >= MAX_STEPS_PER_FRAME) this.acc = 0; // no death spiral
      this.dispatchEvents();
    } else {
      this.input.clearEdges();
    }

    this.fx.step(DT, this.world);
    this.render();
    this.writeHud();

    if (this.world.over && this.overAt < 0) this.overAt = t;
    if (this.overAt >= 0 && !this.overDispatched && t - this.overAt >= DEATH_TO_RESULTS_MS) {
      this.overDispatched = true;
      this.stop();
      this.cb.onOver(this.world.matchStats());
      return;
    }

    this.raf = requestAnimationFrame(this.frame);
  };

  private dispatchEvents(): void {
    const events = this.world.drainEvents();
    for (const e of events) {
      this.fx.consumeEvent(e, this.world);
      const sfxKind = SFX_FOR_EVENT[e.kind];
      if (sfxKind) this.sfx.play(sfxKind as Parameters<SfxEngine["play"]>[0]);
      if (
        e.kind === "kill" ||
        e.kind === "wave" ||
        e.kind === "wave_clear" ||
        e.kind === "match_end"
      ) {
        this.cb.onUiEvent(e);
      }
    }
  }

  private render(): void {
    const k = this.scale * this.dpr;
    this.ctx.setTransform(k, 0, 0, k, 0, 0);
    renderGame(this.ctx, this.world, this.fx, this.resolveMonoFont());
  }

  private writeHud(): void {
    const p = this.world.player;
    const hud = this.hud;
    const hpPct = Math.max(0, (p.hp / PLAYER.maxHp) * 100);

    if (hud.hpFill) {
      hud.hpFill.style.width = `${hpPct}%`;
      hud.hpFill.style.backgroundColor = hpPct < 30 ? "#FF3D5A" : "#C8F31D";
    }
    if (hud.hpText) {
      hud.hpText.textContent = String(Math.max(0, Math.ceil(p.hp)));
    }
    if (hud.energyFill) {
      hud.energyFill.style.width = `${Math.max(0, (p.energy / PLAYER.energyMax) * 100)}%`;
    }
    if (hud.score) {
      hud.score.textContent = String(this.world.score).padStart(7, "0");
    }
    if (hud.combo) {
      const c = this.world.combo;
      if (c !== this.lastCombo) {
        hud.combo.textContent = `×${c}`;
        hud.combo.style.color = c > 1 ? "#C8F31D" : "#8A939E";
        if (c > this.lastCombo) {
          // Volt pop on increment.
          hud.combo.style.transition = "none";
          hud.combo.style.transform = "scale(1.45)";
          void hud.combo.offsetWidth;
          hud.combo.style.transition = "transform 160ms ease-out";
          hud.combo.style.transform = "scale(1)";
        }
        this.lastCombo = c;
      }
    }
    if (hud.wave) {
      hud.wave.textContent = `WAVE ${String(this.world.wave).padStart(2, "0")}`;
    }
    if (hud.dashFill) {
      const frac = Math.min(1, Math.max(0, p.dashCd / PLAYER.dashCooldownSec));
      hud.dashFill.style.height = `${frac * 100}%`;
    }
    if (hud.novaChip) {
      hud.novaChip.style.opacity = p.energy >= NOVA.energyCost ? "1" : "0.45";
    }
    if (hud.vignette) {
      hud.vignette.style.opacity = hpPct < 40 ? String((1 - hpPct / 40) * 0.9) : "0";
    }

    // Minimap at 30Hz.
    this.frameCount++;
    if (hud.minimap && this.frameCount % 2 === 0) {
      if (!this.minimapCtx) {
        this.minimapCtx = hud.minimap.getContext("2d");
        if (this.minimapCtx) {
          const d = Math.min(window.devicePixelRatio || 1, 2);
          hud.minimap.width = MINIMAP_W * d;
          hud.minimap.height = MINIMAP_H * d;
          this.minimapCtx.setTransform(d, 0, 0, d, 0, 0);
        }
      }
      if (this.minimapCtx) drawMinimap(this.minimapCtx, this.world);
    }
  }
}

export { WORLD_H, WORLD_W };
