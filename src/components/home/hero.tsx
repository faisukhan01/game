"use client";

/**
 * HOME hero: display headline, callsign deploy form (POST /api/player),
 * season briefing panel and the live stats strip (GET /api/stats).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useReducedMotion } from "framer-motion";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { RULES_HASH } from "@/lib/sim/hash";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { gameSfx } from "@/lib/game/sfx";
import { useGameStore, type PlayerDTO } from "@/store/game-store";

const CALLSIGN_RE = /^[A-Z0-9_-]+$/;

interface StatsDTO {
  players: number;
  matches: number;
  topScore: number;
  seasonEndsAt: string;
}

const fmtInt = (n: number) => n.toLocaleString("en-US");
const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${months[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, "0")} ${d.getUTCFullYear()}`;
};

function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = prev.current;
    const to = value;
    prev.current = value;
    if (reduced || from === to) {
      el.textContent = format(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const dur = 850;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = format(Math.round(from + (to - from) * e));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced, format]);

  return <span ref={ref}>{format(value)}</span>;
}

function ArenaSchematic() {
  const boxes = [
    [200, 150, 220, 40],
    [1180, 150, 220, 40],
    [200, 710, 220, 40],
    [700, 420, 200, 60],
    [1180, 710, 220, 40],
  ];
  const spawns: [number, number][] = [
    [80, 80], [1520, 80], [80, 820], [1520, 820],
    [800, 40], [800, 860], [40, 450], [1560, 450],
  ];
  return (
    <svg viewBox="0 0 1600 900" className="w-full border border-line bg-void" role="img" aria-label="Arena schematic: five cover blocks and eight edge spawn points">
      <rect x="0" y="0" width="1600" height="900" fill="#07080A" />
      {boxes.map(([x, y, w, h], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill="#0E1013" stroke="rgba(255,255,255,0.16)" strokeWidth={2} />
      ))}
      {spawns.map(([x, y], i) => (
        <rect key={i} x={x - 9} y={y - 9} width={18} height={18} fill="none" stroke="#FF3D5A" strokeWidth={3} />
      ))}
      <circle cx={800} cy={450} r={16} fill="#C8F31D" />
      <rect x={784} y={434} width={32} height={32} fill="none" stroke="rgba(200,243,29,0.5)" strokeWidth={2} />
    </svg>
  );
}

export function Hero() {
  const storeCallsign = useGameStore((s) => s.callsign);
  const deployPlayer = useGameStore((s) => s.deploy);
  const [value, setValue] = useState(storeCallsign);
  const [error, setError] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);

  const stats = useQuery({
    queryKey: ["stats"],
    queryFn: () => apiGet<StatsDTO>("/api/stats"),
    refetchInterval: 30_000,
  });

  const onDeploy = useCallback(async () => {
    if (deploying) return;
    const cs = value.trim().toUpperCase().slice(0, 16);
    if (cs.length < 3 || !CALLSIGN_RE.test(cs)) {
      const msg = "CALLSIGN: 3-16 CHARS — A-Z 0-9 _ - ONLY";
      setError(msg);
      toast.error(msg);
      return;
    }
    setDeploying(true);
    setError(null);
    try {
      gameSfx.unlock();
      const player = await apiPost<PlayerDTO>("/api/player", { callsign: cs });
      deployPlayer(player);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "DEPLOY FAILED — CHECK LINK AND RETRY";
      setError(msg);
      toast.error(msg);
      setDeploying(false);
    }
  }, [value, deploying, deployPlayer]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") void onDeploy();
  };

  const s = stats.data;

  return (
    <section id="arena" className="scroll-mt-20 px-4 pb-16 pt-28 md:px-6 md:pt-36">
      <div className="mx-auto max-w-7xl">
        <div className="grid items-end gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
          {/* ---- Left: headline + deploy */}
          <div>
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="font-mono text-[11px] tracking-[0.3em] text-volt"
            >
              {"// SEASON 01 — ONSLAUGHT · LIVE"}
            </motion.p>

            <motion.h1
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24, delay: 0.05, ease: "easeOut" }}
              className="mt-5 font-display font-bold leading-[0.92] tracking-tight"
            >
              <span className="block text-[clamp(2.6rem,8vw,6.5rem)] text-ink">
                DROP IN. LOCK ON.
              </span>
              <span className="text-outline-volt block text-[clamp(2.6rem,8vw,6.5rem)]">
                LEAVE NOTHING.
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, delay: 0.12, ease: "easeOut" }}
              className="mt-6 max-w-xl text-base leading-relaxed text-mute"
            >
              Top-down twin-stick arena survival on a deterministic 60Hz core.
              Chain your combos, route your energy, take the season ladder.
            </motion.p>

            {/* Deploy panel */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, delay: 0.18, ease: "easeOut" }}
              className="clip-notch mt-8 max-w-xl border border-line bg-panel/80 p-5"
            >
              <label
                htmlFor="callsign"
                className="font-mono text-[10px] tracking-[0.3em] text-mute"
              >
                CALLSIGN
              </label>
              <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                <input
                  id="callsign"
                  name="callsign"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={16}
                  placeholder="e.g. REAVER-6"
                  value={value}
                  onChange={(e) =>
                    setValue(e.target.value.toUpperCase().replace(/[^A-Z0-9_\-]/g, "").slice(0, 16))
                  }
                  onKeyDown={onKeyDown}
                  aria-describedby="callsign-hint"
                  className="h-12 flex-1 border border-input bg-void px-3 font-mono text-sm tracking-[0.2em] text-ink placeholder:text-mute/50 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void onDeploy()}
                  disabled={deploying}
                  aria-label="Deploy to arena"
                  className="clip-notch-sm h-12 bg-volt px-6 font-display text-sm font-semibold tracking-[0.14em] text-void transition-all hover:brightness-110 active:translate-y-px disabled:cursor-wait disabled:opacity-60"
                >
                  {deploying ? "DEPLOYING…" : "DEPLOY TO ARENA"}
                </button>
              </div>
              <div className="mt-2 flex min-h-4 items-center justify-between gap-3">
                <p id="callsign-hint" aria-live="polite" className={`font-mono text-[10px] tracking-[0.14em] ${error ? "text-flare" : "text-mute"}`}>
                  {error ?? "3–16 CHARS · A-Z 0-9 _ -"}
                </p>
                <p className="hidden font-mono text-[10px] tracking-[0.14em] text-mute sm:block">
                  WASD MOVE · LMB FIRE · SPACE DASH · E NOVA
                </p>
              </div>
            </motion.div>
          </div>

          {/* ---- Right: season briefing */}
          <motion.aside
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, delay: 0.22, ease: "easeOut" }}
            className="clip-notch border border-line bg-panel/60 p-5"
            aria-label="Season briefing"
          >
            <div className="flex items-center justify-between">
              <p className="font-mono text-[10px] tracking-[0.3em] text-mute">
                SEASON 01 BRIEFING
              </p>
              <span className="inline-block size-1.5 animate-pulse bg-flare" aria-hidden />
            </div>
            <div className="mt-4">
              <ArenaSchematic />
            </div>
            <dl className="mt-4 space-y-2 font-mono text-[11px]">
              {[
                ["MODE", "ONSLAUGHT // OFFLINE"],
                ["WORLD", "1600 × 900"],
                ["TICK", "60 HZ FIXED"],
                ["BOTS", "3 + 2N PER WAVE"],
                ["RULES HASH", RULES_HASH],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-4 border-b border-line/60 pb-2">
                  <dt className="tracking-[0.2em] text-mute">{k}</dt>
                  <dd className="truncate text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </motion.aside>
        </div>

        {/* ---- Live stats strip */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, delay: 0.3, ease: "easeOut" }}
          className="mt-14 grid grid-cols-2 border border-line bg-panel/40 md:grid-cols-4"
          aria-label="Live season statistics"
        >
          {[
            { label: "PLAYERS RATED", value: s ? s.players : null, format: fmtInt },
            { label: "MATCHES FOUGHT", value: s ? s.matches : null, format: fmtInt },
            { label: "TOP SCORE", value: s ? s.topScore : null, format: fmtInt },
            { label: "SEASON ENDS", value: s ? 1 : null, format: () => (s ? fmtDate(s.seasonEndsAt) : "—") },
          ].map((cell, i) => (
            <div
              key={cell.label}
              className={`p-5 ${i > 0 ? "border-line max-md:[&:nth-child(3)]:border-t max-md:[&:nth-child(4)]:border-t md:border-l" : ""} ${i === 2 ? "max-md:border-l-0 max-md:[&:nth-child(3)]:border-l" : ""}`}
            >
              <p className="font-mono text-[10px] tracking-[0.28em] text-mute">{cell.label}</p>
              <p className="mt-2 truncate font-mono text-2xl font-medium text-ink md:text-[1.7rem]">
                {cell.value === null ? (
                  <span className="text-mute">——</span>
                ) : (
                  <AnimatedNumber value={cell.value} format={cell.format} />
                )}
              </p>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
