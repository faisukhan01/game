"use client";

/**
 * VOIDSTRIKE — PLAYING view. Canvas arena + DOM HUD (updated via refs, never
 * re-rendered at frame rate), pause overlay, kill feed, wave banner and
 * twin-stick touch controls.
 */

import { useEffect, useRef } from "react";
import { World } from "@/lib/sim/world";
import { WORLD_H, WORLD_W } from "@/lib/sim/constants";
import { worldYFromGround } from "@/lib/game/characters";
import { Effects } from "@/lib/game/effects";
import { InputManager } from "@/lib/game/input";
import { GameLoop, type HudRefs } from "@/lib/game/loop";
import { gameSfx } from "@/lib/game/sfx";
import { useGameStore } from "@/store/game-store";

type Feed = { el: HTMLDivElement; t: number };

export function Arena() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paused = useGameStore((s) => s.paused);
  const sfxOn = useGameStore((s) => s.sfx);
  const shakeOn = useGameStore((s) => s.shake);
  const setPaused = useGameStore((s) => s.setPaused);
  const setResultStats = useGameStore((s) => s.setResultStats);
  const setView = useGameStore((s) => s.setView);

  const hudRef = useRef<HudRefs>({
    hpFill: null,
    hpText: null,
    energyFill: null,
    score: null,
    combo: null,
    wave: null,
    dashFill: null,
    novaChip: null,
    vignette: null,
    minimap: null,
  });
  const bannerRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const fxRef = useRef<Effects | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const feedItems = useRef<Feed[]>([]);

  /* ---- boot the match once per mount (matchKey remounts us) ---- */
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const seed = Math.floor(Math.random() * 0xffffffff);
    const world = new World(seed);
    const fx = new Effects();
    const input = new InputManager();
    const loop = new GameLoop(canvas, ctx, world, fx, gameSfx, input, hudRef.current, {
      onUiEvent: (e) => {
        if (e.kind === "kill" && feedRef.current) {
          const row = document.createElement("div");
          row.className =
            "pointer-events-none border border-line/70 bg-void/80 px-2 py-1 font-mono text-[10px] tracking-[0.18em] text-ink backdrop-blur-sm";
          row.textContent = `HOSTILE DOWN  +${e.gained ?? 100}${(e.combo ?? 1) > 1 ? `  ×${e.combo}` : ""}`;
          row.style.opacity = "0";
          row.style.transition = "opacity 140ms ease-out";
          feedRef.current.prepend(row);
          requestAnimationFrame(() => {
            row.style.opacity = "1";
          });
          feedItems.current.push({ el: row, t: performance.now() });
        }
        if (e.kind === "wave" && bannerRef.current) {
          bannerRef.current.textContent = `WAVE ${String(e.wave ?? world.wave).padStart(2, "0")} // ${e.count ?? 0} HOSTILES`;
          bannerRef.current.style.opacity = "1";
          bannerRef.current.style.transform = "translateY(0)";
          window.setTimeout(() => {
            if (bannerRef.current) {
              bannerRef.current.style.opacity = "0";
              bannerRef.current.style.transform = "translateY(-8px)";
            }
          }, 1900);
        }
      },
      onOver: (stats) => {
        setResultStats(stats);
        setView("RESULTS");
      },
    });

    fxRef.current = fx;
    inputRef.current = input;
    loopRef.current = loop;

    input.onPauseToggle = () => setPaused(!useGameStore.getState().paused);

    /* canvas sizing — 16:9 letterboxed */
    const resize = () => {
      const cw = wrap.clientWidth;
      const ch = wrap.clientHeight;
      const scale = Math.min(cw / WORLD_W, ch / WORLD_H);
      const w = Math.max(1, Math.floor(WORLD_W * scale));
      const h = Math.max(1, Math.floor(WORLD_H * scale));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      loop.setScale(scale, dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    /* pointer aim + fire (screen y is the tilted floor — invert projection) */
    const toWorld = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const scale = rect.width / WORLD_W || 1;
      const sx = (clientX - rect.left) / scale;
      const sy = (clientY - rect.top) / scale;
      input.setMouseWorld(sx, worldYFromGround(sy));
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "mouse") toWorld(e.clientX, e.clientY);
    };
    const onDown = (e: PointerEvent) => {
      gameSfx.unlock();
      if (e.pointerType === "mouse") {
        toWorld(e.clientX, e.clientY);
        if (e.button === 2) input.queueNova();
        else input.setFireHeld(true);
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 2) input.setFireHeld(false);
    };
    const onCtx = (e: Event) => e.preventDefault();
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    canvas.addEventListener("contextmenu", onCtx);
    const onKeyFire = (e: KeyboardEvent) => {
      /* fallback: allow holding J to fire for trackpads without LMB */
    };
    void onKeyFire;

    /* twin virtual sticks */
    const stickState: Record<string, { id: number; ox: number; oy: number }> = {
      move: { id: -1, ox: 0, oy: 0 },
      aim: { id: -1, ox: 0, oy: 0 },
    };
    const STICK_R = 56;
    const onTouchStart = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      const rect = wrap.getBoundingClientRect();
      const side = e.clientX - rect.left < rect.width / 2 ? "move" : "aim";
      if (stickState[side].id !== -1) return;
      stickState[side] = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      if (side === "aim") input.aimStick.active = true;
      else input.moveStick.active = true;
    };
    const onTouchMove = (e: PointerEvent) => {
      for (const side of ["move", "aim"] as const) {
        const st = stickState[side];
        if (st.id !== e.pointerId) continue;
        let dx = e.clientX - st.ox;
        let dy = e.clientY - st.oy;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > STICK_R) {
          dx = (dx / len) * STICK_R;
          dy = (dy / len) * STICK_R;
        }
        const nx = dx / STICK_R;
        const ny = dy / STICK_R;
        if (side === "move") {
          input.moveStick.x = nx;
          input.moveStick.y = ny;
        } else {
          input.aimStick.x = nx;
          input.aimStick.y = ny;
        }
      }
    };
    const onTouchEnd = (e: PointerEvent) => {
      for (const side of ["move", "aim"] as const) {
        if (stickState[side].id === e.pointerId) {
          stickState[side].id = -1;
          if (side === "move") {
            input.moveStick.active = false;
            input.moveStick.x = 0;
            input.moveStick.y = 0;
          } else {
            input.aimStick.active = false;
            input.aimStick.x = 0;
            input.aimStick.y = 0;
          }
        }
      }
    };
    wrap.addEventListener("pointerdown", onTouchStart);
    wrap.addEventListener("pointermove", onTouchMove);
    wrap.addEventListener("pointerup", onTouchEnd);
    wrap.addEventListener("pointercancel", onTouchEnd);

    /* pause when tab hidden */
    const onVis = () => {
      if (document.hidden) setPaused(true);
    };
    document.addEventListener("visibilitychange", onVis);

    input.attach();
    loop.start();

    return () => {
      loop.stop();
      input.detach();
      ro.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("contextmenu", onCtx);
      wrap.removeEventListener("pointerdown", onTouchStart);
      wrap.removeEventListener("pointermove", onTouchMove);
      wrap.removeEventListener("pointerup", onTouchEnd);
      wrap.removeEventListener("pointercancel", onTouchEnd);
      document.removeEventListener("visibilitychange", onVis);
      for (const f of feedItems.current) f.el.remove();
      feedItems.current = [];
    };
  }, []);

  /* ---- store → engine sync ---- */
  useEffect(() => {
    if (loopRef.current) loopRef.current.paused = paused;
    if (inputRef.current) {
      if (paused) inputRef.current.clearEdges();
      inputRef.current.onPauseToggle = () => setPaused(!useGameStore.getState().paused);
    }
  }, [paused, setPaused]);

  useEffect(() => {
    gameSfx.enabled = sfxOn;
  }, [sfxOn]);

  useEffect(() => {
    if (fxRef.current) fxRef.current.shakeEnabled = shakeOn;
  }, [shakeOn]);

  /* feed decay */
  useEffect(() => {
    const iv = window.setInterval(() => {
      const now = performance.now();
      feedItems.current = feedItems.current.filter((f) => {
        const age = now - f.t;
        if (age > 2800) {
          f.el.style.opacity = "0";
          window.setTimeout(() => f.el.remove(), 200);
          return false;
        }
        return true;
      });
    }, 400);
    return () => window.clearInterval(iv);
  }, []);

  const stickBtn =
    "flex size-16 select-none items-center justify-center border border-line bg-void/80 font-mono text-[10px] tracking-[0.2em] text-ink backdrop-blur-sm active:bg-volt active:text-void";

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-void">
      {/* top status strip */}
      <div className="flex items-center justify-between border-b border-line bg-void/90 px-3 py-2 font-mono text-[10px] tracking-[0.24em] text-mute md:px-5">
        <span className="text-volt">ONSLAUGHT // OFFLINE SIM</span>
        <span ref={(el) => { hudRef.current.wave = el; }} className="text-ink">WAVE 01</span>
        <button
          type="button"
          onClick={() => setPaused(true)}
          className="border border-line px-2 py-1 tracking-[0.24em] text-ink hover:border-volt hover:text-volt"
          aria-label="Pause match"
        >
          {"P // PAUSE"}
        </button>
      </div>

      {/* arena wrap */}
      <div ref={wrapRef} className="relative flex flex-1 items-center justify-center overflow-hidden">
        <canvas
          ref={canvasRef}
          className="block touch-none bg-void"
          aria-label="VOIDSTRIKE arena — side-view twin-stick shooter canvas"
          role="img"
        />

        {/* HUD: HP + energy (top-left) */}
        <div className="pointer-events-none absolute left-3 top-3 w-48 md:left-5 md:top-5 md:w-60">
          <div className="border border-line bg-void/80 p-2 backdrop-blur-sm">
            <div className="flex items-baseline justify-between font-mono text-[9px] tracking-[0.26em] text-mute">
              <span>INTEGRITY</span>
              <span ref={(el) => { hudRef.current.hpText = el; }} className="text-ink">100</span>
            </div>
            <div className="mt-1 h-1.5 w-full bg-line/60">
              <div ref={(el) => { hudRef.current.hpFill = el; }} className="h-full w-full" style={{ backgroundColor: "#C8F31D" }} />
            </div>
            <div className="mt-2 flex items-baseline justify-between font-mono text-[9px] tracking-[0.26em] text-mute">
              <span>ENERGY</span>
            </div>
            <div className="mt-1 h-1.5 w-full bg-line/60">
              <div ref={(el) => { hudRef.current.energyFill = el; }} className="h-full w-full" style={{ backgroundColor: "#C8F31D" }} />
            </div>
          </div>
          {/* minimap */}
          <div className="mt-2 border border-line bg-void/80 p-1 backdrop-blur-sm">
            <canvas
              ref={(el) => { hudRef.current.minimap = el; }}
              width={140}
              height={80}
              className="block h-auto w-[140px]"
              aria-label="Arena minimap"
            />
          </div>
        </div>

        {/* HUD: score + combo (top-right) */}
        <div className="pointer-events-none absolute right-3 top-3 text-right md:right-5 md:top-5">
          <p className="font-mono text-2xl font-medium text-ink md:text-3xl">
            <span ref={(el) => { hudRef.current.score = el; }}>0000000</span>
          </p>
          <p className="mt-1 font-mono text-sm tracking-[0.2em]">
            <span ref={(el) => { hudRef.current.combo = el; }} className="text-mute">×1</span>
          </p>
          {/* kill feed */}
          <div ref={feedRef} className="mt-2 flex flex-col items-end gap-1" aria-live="polite" />
        </div>

        {/* wave banner */}
        <div
          ref={bannerRef}
          className="pointer-events-none absolute left-1/2 top-[18%] -translate-x-1/2 border border-line bg-void/85 px-6 py-2 font-display text-sm font-semibold tracking-[0.3em] text-amber opacity-0 backdrop-blur-sm transition-all duration-300 md:text-base"
          aria-live="polite"
        />

        {/* low-hp vignette */}
        <div
          ref={(el) => { hudRef.current.vignette = el; }}
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300"
          style={{ boxShadow: "inset 0 0 140px 40px rgba(255,61,90,0.55)" }}
        />

        {/* touch controls */}
        <div className="absolute bottom-4 left-4 select-none md:hidden" aria-hidden>
          <div className="relative size-28 rounded-full border border-line/70 bg-void/40">
            <div className="absolute left-1/2 top-1/2 size-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-volt/50 bg-volt/20" />
          </div>
        </div>
        <div className="absolute bottom-4 right-4 flex select-none items-end gap-3 md:hidden" aria-hidden>
          <div className="relative size-28 rounded-full border border-line/70 bg-void/40">
            <div className="absolute left-1/2 top-1/2 size-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-flare/50 bg-flare/20" />
          </div>
          <div className="flex flex-col gap-2">
            <button type="button" className={stickBtn} onPointerDown={() => inputRef.current?.queueDash()}>
              DASH
            </button>
            <button type="button" className={stickBtn} onPointerDown={() => inputRef.current?.queueNova()}>
              NOVA
            </button>
          </div>
        </div>
      </div>

      {/* bottom ability chips */}
      <div className="flex items-center justify-center gap-4 border-t border-line bg-void/90 px-3 py-2 font-mono text-[10px] tracking-[0.22em] text-mute">
        <span className="flex items-center gap-2">
          DASH
          <span className="relative block h-8 w-1.5 overflow-hidden bg-line/60">
            <span ref={(el) => { hudRef.current.dashFill = el; }} className="absolute bottom-0 left-0 block w-full bg-volt" style={{ height: "0%" }} />
          </span>
        </span>
        <span ref={(el) => { hudRef.current.novaChip = el; }} className="flex items-center gap-2">
          NOVA <span className="text-ink">55⚡</span>
        </span>
        <span className="hidden md:inline">PROTOCOL v1 · 60 HZ · DETERMINISTIC CORE</span>
        <span className="md:hidden">PROTOCOL v1</span>
      </div>

      {/* pause overlay */}
      {paused && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-void/85 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Match paused">
          <div className="w-[min(92vw,420px)] border border-line bg-panel p-6">
            <p className="font-mono text-[10px] tracking-[0.3em] text-volt">{"// MATCH PAUSED"}</p>
            <h2 className="mt-2 font-display text-2xl font-bold text-ink">STANDBY</h2>
            <div className="mt-5 space-y-3">
              <button
                type="button"
                onClick={() => setPaused(false)}
                className="h-12 w-full bg-volt font-display text-sm font-semibold tracking-[0.16em] text-void hover:brightness-110"
              >
                RESUME
              </button>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => useGameStore.getState().setSfx(!sfxOn)}
                  className="h-11 border border-line font-mono text-[11px] tracking-[0.2em] text-ink hover:border-volt"
                  aria-pressed={sfxOn}
                >
                  SFX: {sfxOn ? "ON" : "OFF"}
                </button>
                <button
                  type="button"
                  onClick={() => useGameStore.getState().setShake(!shakeOn)}
                  className="h-11 border border-line font-mono text-[11px] tracking-[0.2em] text-ink hover:border-volt"
                  aria-pressed={shakeOn}
                >
                  SHAKE: {shakeOn ? "ON" : "OFF"}
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPaused(false);
                  useGameStore.getState().goHome();
                }}
                className="h-11 w-full border border-line font-mono text-[11px] tracking-[0.2em] text-flare hover:border-flare"
              >
                ABANDON RUN
              </button>
            </div>
            <p className="mt-4 font-mono text-[10px] leading-relaxed tracking-[0.14em] text-mute">
              WASD MOVE · LMB FIRE · SPACE DASH · E NOVA · P PAUSE
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
