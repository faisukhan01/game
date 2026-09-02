"use client";

/**
 * VOIDSTRIKE — RANKED section: season ladder, live from /api/leaderboard.
 */

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

interface LeaderRow {
  rank: number;
  callsign: string;
  bestScore: number;
  bestWave: number;
  matches?: number;
}

const TIER = (rank: number): { label: string; cls: string } => {
  if (rank === 1) return { label: "VOIDWALKER", cls: "text-volt" };
  if (rank <= 3) return { label: "REAVER", cls: "text-amber" };
  if (rank <= 10) return { label: "SPECTRE", cls: "text-mint" };
  return { label: "OPERATOR", cls: "text-mute" };
};

export function Ranked() {
  const q = useQuery({
    queryKey: ["leaderboard", "home"],
    queryFn: () => apiGet<LeaderRow[]>("/api/leaderboard?limit=10"),
    refetchInterval: 30_000,
  });
  const rows = q.data ?? [];

  return (
    <section id="ranked" className="scroll-mt-20 border-t border-line px-4 py-16 md:px-6 md:py-24">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="font-display text-2xl font-bold tracking-tight text-ink md:text-4xl">
            SEASON LADDER
          </h2>
          <p className="font-mono text-[10px] tracking-[0.3em] text-mute">
            {"// S01 · ONSLAUGHT · GLOBAL · REFRESHES LIVE"}
          </p>
        </div>

        <div className="mt-8 border border-line">
          {/* header */}
          <div className="grid grid-cols-[3.5rem_1fr_7rem_5rem] gap-3 border-b border-line bg-panel px-4 py-2.5 font-mono text-[10px] tracking-[0.26em] text-mute md:grid-cols-[4rem_1fr_10rem_7rem_8rem]">
            <span>RANK</span>
            <span>CALLSIGN</span>
            <span className="hidden md:block">TIER</span>
            <span className="text-right">BEST</span>
            <span className="text-right">WAVE</span>
          </div>

          {q.isLoading && (
            <div className="px-4 py-10 text-center font-mono text-xs tracking-[0.3em] text-mute">
              FETCHING LADDER…
            </div>
          )}

          {!q.isLoading && rows.length === 0 && (
            <div className="px-4 py-10 text-center font-mono text-xs tracking-[0.3em] text-mute">
              NO RECORDS. THE ARENA AWAITS.
            </div>
          )}

          {rows.map((r, i) => {
            const tier = TIER(r.rank);
            return (
              <div
                key={`${r.callsign}-${i}`}
                className={`grid grid-cols-[3.5rem_1fr_7rem_5rem] items-center gap-3 px-4 py-3 font-mono text-xs transition-colors hover:bg-panel md:grid-cols-[4rem_1fr_10rem_7rem_8rem] ${
                  i > 0 ? "border-t border-line/60" : ""
                } ${i < 3 ? "bg-volt/[0.04]" : ""}`}
              >
                <span className={r.rank <= 3 ? "font-bold text-volt" : "text-mute"}>
                  #{r.rank}
                </span>
                <span className="truncate tracking-[0.14em] text-ink">{r.callsign}</span>
                <span className={`hidden tracking-[0.22em] md:block ${tier.cls}`}>
                  {tier.label}
                </span>
                <span className="text-right text-ink">
                  {r.bestScore.toLocaleString("en-US")}
                </span>
                <span className="text-right text-mute">W{r.bestWave}</span>
              </div>
            );
          })}
        </div>

        <p className="mt-3 font-mono text-[10px] leading-relaxed tracking-[0.18em] text-mute/70">
          SCORES VALIDATED SERVER-SIDE · SANITY CHECK 5000 + 500×KILLS + 400×WAVE + 2×DURATION
        </p>
      </div>
    </section>
  );
}
