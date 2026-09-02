"use client";

/**
 * VOIDSTRIKE — RESULTS view. Posts the finished match to /api/matches,
 * shows global rank + leaderboard delta, offers RE-DEPLOY / HOME.
 * Failed submissions are stored locally and can be retried (never lose a run).
 */

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { useGameStore, storeLastMatch, readLastMatch } from "@/store/game-store";

interface LeaderRow {
  rank: number;
  callsign: string;
  bestScore: number;
  bestWave: number;
}

function isSubmissionPayload(v: unknown): v is {
  callsign: string;
  score: number;
  kills: number;
  wave: number;
  durationSec: number;
  bestCombo: number;
} {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.callsign === "string" &&
    typeof o.score === "number" &&
    typeof o.kills === "number" &&
    typeof o.wave === "number" &&
    typeof o.durationSec === "number"
  );
}

export function Results() {
  const stats = useGameStore((s) => s.resultStats);
  const player = useGameStore((s) => s.player);
  const redeploy = useGameStore((s) => s.redeploy);
  const goHome = useGameStore((s) => s.goHome);

  const [rank, setRank] = useState<number | null>(null);
  const [top, setTop] = useState<LeaderRow[] | null>(null);
  const [submitState, setSubmitState] = useState<"pending" | "ok" | "error">("pending");

  /* Build the submission payload once. Falls back to the locally stored
     last match when arriving here without stats (e.g. after a reload). */
  const [payload] = useState(() => {
    if (stats && player) {
      return {
        callsign: player.callsign,
        score: stats.score,
        kills: stats.kills,
        wave: stats.wave,
        durationSec: stats.durationSec,
        bestCombo: stats.bestCombo,
      };
    }
    const stored = readLastMatch();
    return stored && isSubmissionPayload(stored) ? stored : null;
  });

  const submit = useCallback(async () => {
    const p = payload;
    if (!p) {
      setSubmitState("error");
      return;
    }
    setSubmitState("pending");
    try {
      const res = await apiPost<{ player: unknown; rank: number; top: LeaderRow[] }>(
        "/api/matches",
        {
          callsign: p.callsign,
          score: p.score,
          kills: p.kills,
          wave: p.wave,
          durationSec: p.durationSec,
        },
      );
      setRank(res.rank);
      setTop(res.top);
      setSubmitState("ok");
      storeLastMatch(p);
    } catch (e) {
      setSubmitState("error");
      const msg = e instanceof ApiError ? e.message : "TRANSMISSION FAILED — RETRY";
      toast.error(msg);
    }
  }, [payload]);

  /* Submission is initiated on mount — an intentional fire-and-forget:
     the view exists only after a finished run and must transmit once. */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void submit();
  }, [submit]);

  const leaderboard = useQuery({
    queryKey: ["leaderboard", "results"],
    queryFn: () => apiGet<LeaderRow[]>("/api/leaderboard?limit=10"),
    enabled: submitState !== "pending",
  });

  const p = payload;
  const rows = top ?? leaderboard.data ?? [];

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-void">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-4 py-10">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: "easeOut" }}
          className="clip-notch border border-line bg-panel p-6 md:p-8"
        >
          <p className="font-mono text-[10px] tracking-[0.3em] text-flare">
            {"// SIGNAL LOST — RUN TERMINATED"}
          </p>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-ink md:text-5xl">
            RUN COMPLETE
          </h1>

          {p ? (
            <>
              <div className="mt-6 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
                {[
                  ["SCORE", p.score.toLocaleString("en-US"), "text-volt"],
                  ["KILLS", String(p.kills), "text-ink"],
                  ["WAVE", String(p.wave), "text-ink"],
                  ["BEST COMBO", `×${p.bestCombo}`, "text-amber"],
                ].map(([k, v, c]) => (
                  <div key={k} className="bg-panel p-4">
                    <p className="font-mono text-[9px] tracking-[0.26em] text-mute">{k}</p>
                    <p className={`mt-1 font-mono text-xl font-medium md:text-2xl ${c}`}>{v}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex items-center justify-between border border-line bg-void/60 px-4 py-3">
                <span className="font-mono text-[10px] tracking-[0.26em] text-mute">GLOBAL RANK</span>
                {submitState === "pending" && (
                  <span className="font-mono text-sm text-mute">TRANSMITTING…</span>
                )}
                {submitState === "ok" && rank !== null && (
                  <span className="font-mono text-xl font-medium text-volt">
                    #{rank}
                  </span>
                )}
                {submitState === "error" && (
                  <button
                    type="button"
                    onClick={() => void submit()}
                    className="border border-flare px-3 py-1 font-mono text-[10px] tracking-[0.22em] text-flare hover:bg-flare hover:text-void"
                  >
                    RETRY TRANSMISSION
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="mt-4 font-mono text-xs tracking-[0.2em] text-mute">
              NO RUN DATA ON RECORD.
            </p>
          )}

          {/* leaderboard delta */}
          {rows.length > 0 && (
            <div className="mt-6">
              <p className="font-mono text-[10px] tracking-[0.3em] text-mute">SEASON LADDER — TOP 10</p>
              <div className="mt-2 border border-line">
                {rows.map((r, i) => {
                  const mine =
                    p && r.callsign === p.callsign && p.score >= r.bestScore;
                  return (
                    <div
                      key={`${r.callsign}-${i}`}
                      className={`grid grid-cols-[3rem_1fr_auto_auto] items-center gap-3 px-4 py-2 font-mono text-xs ${
                        mine ? "bg-volt/10 text-volt" : i % 2 ? "bg-panel/60" : "bg-transparent"
                      } ${i > 0 ? "border-t border-line/60" : ""}`}
                    >
                      <span className="text-mute">#{r.rank}</span>
                      <span className="truncate tracking-[0.14em] text-ink">{r.callsign}</span>
                      <span className="text-right text-ink">
                        {r.bestScore.toLocaleString("en-US")}
                      </span>
                      <span className="w-14 text-right text-mute">W{r.bestWave}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={redeploy}
              className="clip-notch-sm h-12 flex-1 bg-volt font-display text-sm font-semibold tracking-[0.16em] text-void hover:brightness-110"
            >
              RE-DEPLOY
            </button>
            <button
              type="button"
              onClick={goHome}
              className="h-12 flex-1 border border-line font-mono text-xs tracking-[0.22em] text-ink hover:border-volt hover:text-volt"
            >
              RETURN TO BASE
            </button>
          </div>
        </motion.div>

        <p className="mt-4 text-center font-mono text-[10px] tracking-[0.3em] text-mute">
          VOIDSTRIKE · PROTOCOL v1 · 60 HZ DETERMINISTIC CORE
        </p>
      </div>
    </div>
  );
}
