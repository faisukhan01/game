"use client";

/**
 * VOIDSTRIKE — client view state + settings. Discrete state only:
 * per-frame HUD values are written straight to DOM refs by the game loop.
 */

import { create } from "zustand";
import type { MatchStats } from "@/lib/sim/types";

export type View = "HOME" | "PLAYING" | "RESULTS";

export interface PlayerDTO {
  id: string;
  callsign: string;
  bestScore: number;
  totalScore: number;
  matches: number;
  kills: number;
  bestWave: number;
}

export interface MatchResponse {
  player: PlayerDTO;
  rank: number;
  top: PlayerDTO[];
}

const LS_SFX = "voidstrike.sfx";
const LS_SHAKE = "voidstrike.shake";
const LS_CALLSIGN = "voidstrike.callsign";
const LS_LAST_MATCH = "voidstrike.lastMatch";

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable — settings simply do not persist.
  }
}

interface GameState {
  view: View;
  callsign: string;
  player: PlayerDTO | null;
  paused: boolean;
  sfx: boolean;
  shake: boolean;
  /** Increments per deploy — remounts the game view for a fresh match. */
  matchKey: number;
  resultStats: MatchStats | null;

  hydrate: () => void;
  setView: (v: View) => void;
  setCallsign: (c: string) => void;
  setPlayer: (p: PlayerDTO | null) => void;
  setPaused: (p: boolean) => void;
  setSfx: (v: boolean) => void;
  setShake: (v: boolean) => void;
  setResultStats: (s: MatchStats | null) => void;
  deploy: (player: PlayerDTO) => void;
  redeploy: () => void;
  goHome: () => void;
}

export const useGameStore = create<GameState>((set) => ({
  view: "HOME",
  callsign: "",
  player: null,
  paused: false,
  sfx: true,
  shake: true,
  matchKey: 0,
  resultStats: null,

  hydrate: () => {
    set({
      sfx: readBool(LS_SFX, true),
      shake: readBool(LS_SHAKE, true),
      callsign: readString(LS_CALLSIGN, ""),
    });
  },

  setView: (view) => set({ view }),
  setCallsign: (callsign) => {
    set({ callsign });
    write(LS_CALLSIGN, callsign);
  },
  setPlayer: (player) => set({ player }),
  setPaused: (paused) => set({ paused }),
  setSfx: (sfx) => {
    set({ sfx });
    write(LS_SFX, sfx ? "1" : "0");
  },
  setShake: (shake) => {
    set({ shake });
    write(LS_SHAKE, shake ? "1" : "0");
  },
  setResultStats: (resultStats) => set({ resultStats }),

  deploy: (player) =>
    set((s) => ({
      player,
      callsign: player.callsign,
      view: "PLAYING",
      paused: false,
      matchKey: s.matchKey + 1,
      resultStats: null,
    })),

  redeploy: () =>
    set((s) => ({
      view: "PLAYING",
      paused: false,
      matchKey: s.matchKey + 1,
      resultStats: null,
    })),

  goHome: () => set({ view: "HOME", paused: false, resultStats: null }),
}));

export interface StoredMatch {
  callsign: string;
  score: number;
  kills: number;
  wave: number;
  durationSec: number;
  bestCombo: number;
  savedAt: number;
}

export function storeLastMatch(m: StoredMatch): void {
  write(LS_LAST_MATCH, JSON.stringify(m));
}

export function readLastMatch(): StoredMatch | null {
  try {
    const raw = window.localStorage.getItem(LS_LAST_MATCH);
    if (!raw) return null;
    return JSON.parse(raw) as StoredMatch;
  } catch {
    return null;
  }
}

function readString(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
