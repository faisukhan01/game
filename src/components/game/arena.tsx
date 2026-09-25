"use client";

/**
 * VOIDSTRIKE — PLAYING view. GTA-style third-person arena: full-bleed 3D
 * canvas + DOM HUD (updated via refs, never re-rendered at frame rate),
 * mouse-look (pointer lock with drag fallback), pause overlay, kill feed,
 * wave banner and touch controls (move stick, look drag, FIRE/DASH/NOVA).
 */

import { useEffect, useRef } from "react";
import { World } from "@/lib/sim/world";
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

    const seed = Math.floor(Math.random() * 0xffffffff);
    const world = new World(seed);
    const fx = new Effects();
    const input = new InputManager();
    const loop = new GameLoop(canvas, world, fx, gameSfx, input, hudRef.current, {
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

    /* canvas sizing — full-bleed, the 3D camera adapts to any aspect */
    const resize = () => {
      const cw = wrap.clientWidth;
      const ch = wrap.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
      loop.resize(cw, ch, dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    /* --- mouse look: pointer lock when possible, drag otherwise --- */
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const requestLock = (): void => {
      try {
        const el = canvas as HTMLCanvasElement & {
          requestPointerLock?: (opts?: { unadjustedMovement?: boolean }) => Promise<void> | void;
        };
        el.requestPointerLock?.();
      } catch {
        /* pointer lock unavailable — drag mode covers us */
      }
    };
    const onMouseDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      gameSfx.unlock();
      if (e.button === 2) {
        input.queueNova();
        return;
      }
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      input.setFireHeld(true);
      if (document.pointerLockElement !== canvas) requestLock();
    };
    const onMouseMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const locked = document.pointerLockElement === canvas;
      if (locked) {
        loop.look(e.movementX, e.movementY);
      } else if (dragging) {
        loop.look(e.clientX - lastX, e.clientY - lastY);
        lastX = e.clientX;
        lastY = e.clientY;
      }
    };
    const onMouseUp = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      if (e.button !== 2) {
        dragging = false;
        input.setFireHeld(false);
      }
    };
    const onCtx = (e: Event) => e.preventDefault();
    canvas.addEventListener("pointerdown", onMouseDown);
    canvas.addEventListener("pointermove", onMouseMove);
    window.addEventListener("pointerup", onMouseUp);
    canvas.addEventListener("contextmenu", onCtx);

    /* --- touch: left = move stick, right = look drag, buttons = actions --- */
    const stickState = { moveId: -1, ox: 0, oy: 0, lookId: -1, lx: 0, ly: 0 };
    const STICK_R = 56;
    const onTouchStart = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      gameSfx.unlock();
      input.aimAssist = true;
      const rect = wrap.getBoundingClientRect();
      if (e.clientX - rect.left < rect.width / 2) {
        if (stickState.moveId === -1) {
          stickState.moveId = e.pointerId;
          stickState.ox = e.clientX;
          stickState.oy = e.clientY;
          input.moveStick.active = true;
        }
      } else if (stickState.lookId === -1) {
        stickState.lookId = e.pointerId;
        stickState.lx = e.clientX;
        stickState.ly = e.clientY;
      }
    };
    const onTouchMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      if (e.pointerId === stickState.moveId) {
        let dx = e.clientX - stickState.ox;
        let dy = e.clientY - stickState.oy;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > STICK_R) {
          dx = (dx / len) * STICK_R;
          dy = (dy / len) * STICK_R;
        }
        input.moveStick.x = dx / STICK_R;
        input.moveStick.y = dy / STICK_R;
      } else if (e.pointerId === stickState.lookId) {
        loop.look((e.clientX - stickState.lx) * 1.6, (e.clientY - stickState.ly) * 1.2);
        stickState.lx = e.clientX;
        stickState.ly = e.clientY;
      }
    };
    const onTouchEnd = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      if (e.pointerId === stickState.moveId) {
        stickState.moveId = -1;
        input.moveStick.active = false;
        input.moveStick.x = 0;
        input.moveStick.y = 0;
      } else if (e.pointerId === stickState.lookId) {
        stickState.lookId = -1;
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
      loop.dispose();
      input.detach();
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onMouseDown);
      canvas.removeEventListener("pointermove", onMouseMove);
      window.removeEventListener("pointerup", onMouseUp);
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

  const actionBtn =
    "flex select-none items-center justify-center rounded-full border backdrop-blur-sm font-mono tracking-[0.14em] active:scale-95 transition-transform";

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-void">
      {/* top status strip */}
      <div className="flex items-center justify-between gap-2 overflow-hidden border-b border-line bg-void/90 px-3 py-2 font-mono text-[10px] tracking-[0.24em] text-mute md:px-5">
        <span className="hidden shrink-0 text-volt sm:inline">GROVE BLOCK // FREE ROAM COMBAT</span>
        <span ref={(el) => { hudRef.current.wave = el; }} className="shrink-0 text-ink">WAVE 01</span>
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
      <div ref={wrapRef} className="relative flex-1 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 block h-full w-full touch-none"
          aria-label="VOIDSTRIKE arena — third-person city combat canvas"
          role="img"
        />

        {/* projected damage numbers */}
        <div ref={(el) => {
          if (el && loopRef.current && !el.contains(loopRef.current.floaterHost)) {
            el.appendChild(loopRef.current.floaterHost);
          }
        }} className="pointer-events-none absolute inset-0" aria-hidden />

        {/* crosshair (desktop) */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 md:block" aria-hidden>
          <div className="relative size-6">
            <div className="absolute left-1/2 top-1/2 h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-volt shadow-[0_0_6px_rgba(200,243,29,0.9)]" />
            <div className="absolute left-1/2 top-0 h-1.5 w-[1.5px] -translate-x-1/2 bg-volt/70" />
            <div className="absolute bottom-0 left-1/2 h-1.5 w-[1.5px] -translate-x-1/2 bg-volt/70" />
            <div className="absolute left-0 top-1/2 h-[1.5px] w-1.5 -translate-y-1/2 bg-volt/70" />
            <div className="absolute right-0 top-1/2 h-[1.5px] w-1.5 -translate-y-1/2 bg-volt/70" />
          </div>
        </div>

        {/* HUD: HP + energy (top-left) */}
        <div className="pointer-events-none absolute left-3 top-3 w-44 md:left-5 md:top-5 md:w-56">
          <div className="border border-line bg-void/70 p-2 backdrop-blur-sm">
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
          <div className="mt-2 border border-line bg-void/70 p-1 backdrop-blur-sm">
            <canvas
              ref={(el) => { hudRef.current.minimap = el; }}
              width={140}
              height={80}
              className="block h-auto w-[132px] md:w-[140px]"
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
          className="pointer-events-none absolute left-1/2 top-[16%] -translate-x-1/2 border border-line bg-void/85 px-6 py-2 font-display text-sm font-semibold tracking-[0.3em] text-amber opacity-0 backdrop-blur-sm transition-all duration-300 md:text-base"
          aria-live="polite"
        />

        {/* low-hp vignette */}
        <div
          ref={(el) => { hudRef.current.vignette = el; }}
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300"
          style={{ boxShadow: "inset 0 0 140px 40px rgba(255,61,90,0.55)" }}
        />

        {/* touch controls */}
        <div className="absolute bottom-6 left-6 select-none md:hidden" aria-hidden>
          <div className="relative size-28 rounded-full border border-line/70 bg-void/30">
            <div className="absolute left-1/2 top-1/2 size-12 -translate-x-1/2 -translate-y-1/2 rounded-full border border-volt/50 bg-volt/20" />
          </div>
        </div>
        <div className="absolute bottom-6 right-5 flex select-none flex-col items-end gap-3 md:hidden" aria-hidden>
          <div className="flex items-center gap-3">
            <button type="button" className={`${actionBtn} size-14 border-flare/60 bg-flare/15 text-[10px] text-flare`} onPointerDown={() => inputRef.current?.queueNova()}>
              NOVA
            </button>
            <button type="button" className={`${actionBtn} size-14 border-volt/60 bg-volt/15 text-[10px] text-volt`} onPointerDown={() => inputRef.current?.queueDash()}>
              DASH
            </button>
          </div>
          <button
            type="button"
            className={`${actionBtn} size-20 border-volt bg-volt/25 text-xs text-ink`}
            onPointerDown={() => inputRef.current?.setFireHeld(true)}
            onPointerUp={() => inputRef.current?.setFireHeld(false)}
            onPointerLeave={() => inputRef.current?.setFireHeld(false)}
            onPointerCancel={() => inputRef.current?.setFireHeld(false)}
          >
            FIRE
          </button>
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
        <span className="hidden lg:inline">WASD MOVE · MOUSE LOOK · LMB FIRE · RMB NOVA · SPACE DASH · E NOVA · P PAUSE</span>
        <span className="hidden md:inline lg:hidden">LMB FIRE · SPACE DASH · E NOVA</span>
        <span className="md:hidden">LEFT STICK MOVE · DRAG LOOK</span>
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
              WASD MOVE · MOUSE LOOK · LMB FIRE · SPACE DASH · E/RMB NOVA · P PAUSE
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
