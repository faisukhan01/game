"""Gym-style environment wrapping the Protocol v1 sim for RL training.

Observation: 24-dim float32, player-centric.
Action space: Discrete(27) = 3 move × 3 fire × 3 special.
Reward: kill +1.0 · damage dealt +0.01 · damage taken −0.02 ·
        survival +0.001/t · wave clear +0.5 · death −1.0.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from .rules import DT, World

OBS_DIM = 24
N_ACTIONS = 27

MOVE_DIRS = [(0.0, 0.0), (1.0, 0.0), (-1.0, 0.0), (0.0, 1.0), (0.0, -1.0),
             (0.7071067811865476, 0.7071067811865476), (-0.7071067811865476, 0.7071067811865476),
             (0.7071067811865476, -0.7071067811865476), (-0.7071067811865476, -0.7071067811865476)]
# 9 move dirs compressed to 3 buckets for the discrete space: stay / toward-nearest / away
FIRE_MODES = 3  # none / aim-nearest / aim-move-dir
SPECIALS = 3    # none / dash / nova


class VoidstrikeEnv:
    """Deterministic single-player Onslaught environment."""

    metadata = {"render_modes": []}

    def __init__(self, seed: int = 1337, max_ticks: int = 3600) -> None:
        self.seed = seed
        self.max_ticks = max_ticks
        self.world: World | None = None
        self._tick_count = 0
        self._last_hp = 100.0
        self._dealt = 0.0
        self._taken = 0.0

    # -- gym API --
    def reset(self, seed: int | None = None) -> np.ndarray:
        s = self.seed if seed is None else seed
        self.world = World(s & 0xFFFFFFFFFFFFFFFF)
        self._tick_count = 0
        self._last_hp = self.world.units[0].hp
        self._dealt = 0.0
        self._taken = 0.0
        return self._obs()

    def step(self, action: int) -> tuple[np.ndarray, float, bool, dict[str, Any]]:
        if self.world is None:
            raise RuntimeError("call reset() before step()")
        action = int(action) % N_ACTIONS
        move_bucket = action // 9          # 0 stay, 1 toward, 2 away
        fire_mode = (action // 3) % 3      # 0 none, 1 aim nearest, 2 aim move
        special = action % 3               # 0 none, 1 dash, 2 nova

        w = self.world
        p = w.units[w.player_idx]

        # nearest alive bot
        near = None
        nd = 1e18
        for u in w.units[1:]:
            if u.kind == 1 and u.alive:
                d = (u.x - p.x) ** 2 + (u.y - p.y) ** 2
                if d < nd:
                    nd, near = d, u

        mx, my = 0.0, 0.0
        if move_bucket in (1, 2) and near is not None:
            d = math.sqrt(nd) or 1.0
            tx, ty = (near.x - p.x) / d, (near.y - p.y) / d
            mx, my = (tx, ty) if move_bucket == 1 else (-tx, -ty)

        ax, ay = 0.0, 0.0
        fire = False
        if fire_mode == 1 and near is not None:
            d = math.sqrt(nd) or 1.0
            ax, ay = (near.x - p.x) / d, (near.y - p.y) / d
            fire = True
        elif fire_mode == 2 and (mx or my):
            l = math.sqrt(mx * mx + my * my)
            ax, ay = mx / l, my / l
            fire = True

        inp = _InputLite(mx, my, ax, ay, fire, special == 1, special == 2)

        prev_score = w.score
        prev_hp = p.hp
        prev_bot_hp = sum(u.hp for u in w.units[1:] if u.kind == 1 and u.alive)

        w.tick(inp)
        self._tick_count += 1

        # reward shaping from events + deltas
        reward = 0.0
        new_kills = sum(1 for e in w.events if e.kind == "kill")
        reward += 1.0 * new_kills
        reward += 0.001  # survival per tick
        post_bot_hp = sum(u.hp for u in w.units[1:] if u.kind == 1 and u.alive)
        dealt = max(0.0, prev_bot_hp - post_bot_hp)   # damage dealt to bots (kills count fully)
        reward += 0.01 * dealt
        taken = max(0.0, prev_hp - p.hp)
        if taken > 0:
            self._taken += taken
            reward -= 0.02 * taken
        done = bool(w.match_over) or self._tick_count >= self.max_ticks
        if w.match_over:
            reward -= 1.0
        if any(e.kind == "wave" for e in w.events):
            reward += 0.5

        info = {
            "score": w.score - prev_score,
            "kills": new_kills,
            "wave": w.wave,
            "ticks": self._tick_count,
        }
        return self._obs(), reward, done, info

    def _obs(self) -> np.ndarray:
        w = self.world
        assert w is not None
        p = w.units[w.player_idx]
        obs = np.zeros(OBS_DIM, dtype=np.float32)

        obs[0] = p.x / 1600.0
        obs[1] = p.y / 900.0
        obs[2] = p.vx / 260.0
        obs[3] = p.vy / 260.0
        obs[4] = p.hp / 100.0
        obs[5] = p.energy / 100.0
        obs[6] = min(1.0, p.dash_cd / 3.0)
        obs[7] = w.combo / 5.0
        obs[8] = min(1.0, w.wave / 20.0)

        bots = [u for u in w.units[1:] if u.kind == 1 and u.alive]
        bots.sort(key=lambda u: (u.x - p.x) ** 2 + (u.y - p.y) ** 2)
        for k in range(3):
            base = 9 + k * 4
            if k < len(bots):
                u = bots[k]
                obs[base] = (u.x - p.x) / 1600.0
                obs[base + 1] = (u.y - p.y) / 900.0
                obs[base + 2] = u.vx / 240.0
                obs[base + 3] = u.hp / 90.0

        projs = [pr for pr in w.projectiles if pr.alive and pr.team == 1]
        projs.sort(key=lambda pr: (pr.x - p.x) ** 2 + (pr.y - p.y) ** 2)
        if projs:
            pr = projs[0]
            obs[21] = (pr.x - p.x) / 1600.0
            obs[22] = (pr.y - p.y) / 900.0
            obs[23] = min(1.0, math.sqrt(pr.vx ** 2 + pr.vy ** 2) / 480.0)
        return obs

    # -- scripted baseline (used by eval) --
    def scripted_action(self) -> int:
        """Mirror of the golden-vector script, expressed as an action:
        always fire at nearest bot, approach/retreat by range, dash when
        close, nova when packed. Encoded as fire=1 + heuristics."""
        w = self.world
        assert w is not None
        p = w.units[w.player_idx]
        near = None
        nd = 1e18
        count210 = 0
        for u in w.units[1:]:
            if u.kind == 1 and u.alive:
                d2 = (u.x - p.x) ** 2 + (u.y - p.y) ** 2
                if d2 < nd:
                    nd, near = d2, u
                if d2 <= 210.0 ** 2:
                    count210 += 1
        move_bucket = 0
        if near is not None:
            d = math.sqrt(nd)
            move_bucket = 1 if d > 200 else 2
        special = 0
        if near is not None and math.sqrt(nd) < 150.0 and p.dash_cd <= 0:
            special = 1
        elif count210 >= 2 and p.energy >= 55.0:
            special = 2
        return (move_bucket * 9) + (1 * 3) + special  # fire mode 1 = aim nearest


class _InputLite:
    __slots__ = ("move_x", "move_y", "aim_x", "aim_y", "fire", "dash", "nova")

    def __init__(self, mx: float, my: float, ax: float, ay: float,
                 fire: bool, dash: bool, nova: bool) -> None:
        self.move_x, self.move_y = mx, my
        self.aim_x, self.aim_y = ax, ay
        self.fire, self.dash, self.nova = fire, dash, nova


# rules.py tick() accepts duck-typed inputs; keep DT import meaningful
_ = DT
