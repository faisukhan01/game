"""Gym-style RL environment wrapping the Protocol v1 world (``botlab.rules``).

One :meth:`VoidstrikeEnv.step` == one 60 Hz simulation tick.

Action space — ``Discrete(27)`` = 3x3 move x 3 fire x 3 special:

* ``move  = action % 9``            -> index into :data:`MOVES` (index 0 == stay)
* ``fire  = (action // 9) % 3``     -> 0 none, 1 aim-nearest-bot, 2 aim-move-dir
* ``special = action // 18``        -> 0 none, 1 dash, 2 nova

Fire dirs are continuous (unit vector toward the nearest bot, or the current move
dir / facing); only the *move* component is quantized to the 9-dir grid. The dash
direction is the current move dir (falling back to the player's facing).

Observation — 24-dim ``float32``, player-centric (see :meth:`VoidstrikeEnv._observation`
for the exact layout; all components are normalized, angle-preserving).

Reward (per tick): ``+1.0`` kill, ``+0.01`` per point of damage dealt,
``-0.02`` per point of damage taken, ``+0.001`` survive-per-tick, ``+0.5`` wave
clear, ``-1.0`` death. ``done`` is ``True`` on player death (terminated) or when
``max_steps`` is reached (truncated; ``info["truncated"]`` distinguishes them and
no death penalty is applied on truncation).
"""

from __future__ import annotations

from typing import List, Optional, Tuple

import numpy as np

from .rules import (
    BOT_RADIUS,
    COMBO_MAX,
    PLAYER_MAX_HP,
    PLAYER_SPEED,
    PLAYER_DASH_IMPULSE,
    NOVA_ENERGY_COST,
    RIFLE_ENERGY_COST,
    RawInput,
    World,
    normalize,
)

__all__ = ["VoidstrikeEnv", "MOVES", "OBS_DIM", "NUM_ACTIONS"]

OBS_DIM: int = 24
NUM_ACTIONS: int = 27

#: 9 movement options (3x3 grid, index 0 == stay). Order: stay, cardinal, diagonal.
MOVES: Tuple[Tuple[float, float], ...] = (
    (0.0, 0.0),
    (-1.0, 0.0), (1.0, 0.0), (0.0, -1.0), (0.0, 1.0),
    (-1.0, -1.0), (1.0, -1.0), (-1.0, 1.0), (1.0, 1.0),
)

# Reward constants (spec: task 2-b).
REWARD_KILL: float = 1.0
REWARD_DAMAGE_DEALT: float = 0.01
REWARD_DAMAGE_TAKEN: float = -0.02
REWARD_SURVIVE_PER_TICK: float = 0.001
REWARD_WAVE_CLEAR: float = 0.5
REWARD_DEATH: float = -1.0

_VEL_NORM: float = float(PLAYER_DASH_IMPULSE)  # 720; keeps dash velocities ~O(1)
_POS_NORM_X: float = 1600.0
_POS_NORM_Y: float = 900.0
_REL_NORM: float = 1600.0                      # angle-preserving relative positions
_WAVE_NORM: float = 12.0


def _clip1(v: float) -> float:
    if v < -1.0:
        return -1.0
    if v > 1.0:
        return 1.0
    return v


class VoidstrikeEnv:
    """Deterministic single-player wave-survival environment (Protocol v1)."""

    obs_dim: int = OBS_DIM
    n_actions: int = NUM_ACTIONS

    def __init__(self, max_steps: Optional[int] = None) -> None:
        """
        Args:
            max_steps: episode length cap in ticks; ``None`` means run until death.
                Reaching the cap sets ``done=True`` with ``info["truncated"]=True``.
        """
        self.max_steps = max_steps
        self.world: Optional[World] = None
        self._steps: int = 0

    # ------------------------------------------------------------------ API

    def reset(self, seed: int) -> np.ndarray:
        """Reset the world with ``seed`` and return the initial observation."""
        self.world = World(int(seed))
        self._steps = 0
        return self._observation()

    def step(self, action: int) -> Tuple[np.ndarray, float, bool, dict]:
        """Apply a discrete action (0..26) for one tick."""
        if self.world is None:
            raise RuntimeError("reset() must be called before step()")
        action = int(action)
        if not 0 <= action < NUM_ACTIONS:
            raise ValueError(f"action {action} outside [0, {NUM_ACTIONS - 1}]")
        move_idx = action % 9
        fire_idx = (action // 9) % 3
        special_idx = action // 18

        move = MOVES[move_idx]
        fire: Optional[Tuple[float, float]] = None
        if fire_idx == 1:
            fire = self._nearest_bot_dir()
        elif fire_idx == 2:
            assert self.world is not None
            if move[0] != 0.0 or move[1] != 0.0:
                fire = normalize(move)  # already unit length
            else:
                fire = self.world.facing
        dash = special_idx == 1
        nova = special_idx == 2
        return self.step_raw(move, fire, dash, nova)

    def step_raw(
        self,
        move: Tuple[float, float],
        fire: Optional[Tuple[float, float]] = None,
        dash: bool = False,
        nova: bool = False,
    ) -> Tuple[np.ndarray, float, bool, dict]:
        """Apply a continuous input frame for one tick (used by scripted policies)."""
        world = self.world
        if world is None:
            raise RuntimeError("reset() must be called before step_raw()")
        if world.done:
            raise RuntimeError("episode has ended; call reset()")
        world.tick(RawInput(move=move, fire=fire, dash=dash, nova=nova))
        self._steps += 1

        reward = 0.0
        for ev in world.events:
            kind = ev["kind"]
            if kind == "hit":
                reward += (REWARD_DAMAGE_DEALT if ev["from_player"] else REWARD_DAMAGE_TAKEN) * ev["damage"]
            elif kind == "kill":
                reward += REWARD_KILL
            elif kind == "wave_cleared":
                reward += REWARD_WAVE_CLEAR
            elif kind == "match_end":
                reward += REWARD_DEATH
        terminated = world.done
        truncated = False
        if not terminated and self.max_steps is not None and self._steps >= self.max_steps:
            truncated = True
            world.done = True  # halt the sim; distinguishes from death via the flag below
        if not terminated:
            reward += REWARD_SURVIVE_PER_TICK

        done = terminated or truncated
        info = {
            "tick": world.tick,
            "score": world.score,
            "wave": world.wave,
            "kills": world.kills,
            "combo": world.combo,
            "hp": world.player.hp,
            "energy": world.energy,
            "bots_alive": len(world.bots),
            "checksum": world.checksum,
            "events": list(world.events),
            "terminated": terminated,
            "truncated": truncated,
            "steps": self._steps,
        }
        return self._observation(), reward, done, info

    # ------------------------------------------------------------ internals

    def _nearest_bot_dir(self) -> Tuple[float, float]:
        """Unit dir toward the nearest live bot; ``(1, 0)`` when none (scripted semantics)."""
        assert self.world is not None
        p = self.world.player
        best: Optional[Tuple[float, float]] = None
        best_d2 = float("inf")
        for bot in self.world.bots:
            if bot.hp <= 0.0:
                continue
            dx = bot.x - p.x
            dy = bot.y - p.y
            d2 = dx * dx + dy * dy
            if d2 < best_d2:
                best_d2 = d2
                best = (dx, dy)
        if best is None:
            return (1.0, 0.0)
        return normalize(best) or (1.0, 0.0)

    def _observation(self) -> np.ndarray:
        """Build the 24-dim player-centric observation.

        Layout::

            [0] x/1600                [1] y/900
            [2] vx/720 (clip +-1)     [3] vy/720 (clip +-1)
            [4] hp/100                [5] energy/100
            [6..9]   bot 0: dx/1600, dy/1600, rvx/720 clip, rvy/720 clip
            [10..13] bot 1: same      [14..17] bot 2: same   (nearest first, zeros if absent)
            [18..21] nearest projectile: dx/1600, dy/1600, rvx/720 clip, rvy/720 clip
            [22] combo/5              [23] min(wave,12)/12

        Relative positions use a uniform 1600-unit scale so angles are preserved;
        bot hp is intentionally excluded to fit the 24-dim budget (bot threat is
        conveyed by position/velocity; wave difficulty by dim 23).
        """
        world = self.world
        assert world is not None
        p = world.player
        obs = np.zeros(OBS_DIM, dtype=np.float32)
        obs[0] = p.x / _POS_NORM_X
        obs[1] = p.y / _POS_NORM_Y
        obs[2] = _clip1(p.vx / _VEL_NORM)
        obs[3] = _clip1(p.vy / _VEL_NORM)
        obs[4] = _clip1(p.hp / PLAYER_MAX_HP)
        obs[5] = world.energy / 100.0

        p_x, p_y, p_vx, p_vy = p.x, p.y, p.vx, p.vy
        bots_sorted = sorted(
            world.bots,
            key=lambda b: (b.x - p_x) ** 2 + (b.y - p_y) ** 2 if b.hp > 0.0 else float("inf"),
        )[:3]
        for i, bot in enumerate(bots_sorted):
            base = 6 + 4 * i
            obs[base] = (bot.x - p_x) / _REL_NORM
            obs[base + 1] = (bot.y - p_y) / _REL_NORM
            obs[base + 2] = _clip1((bot.vx - p_vx) / _VEL_NORM)
            obs[base + 3] = _clip1((bot.vy - p_vy) / _VEL_NORM)

        best_proj: Optional[object] = None
        best_d2 = float("inf")
        for proj in world.projectiles:
            dx = proj.x - p_x
            dy = proj.y - p_y
            d2 = dx * dx + dy * dy
            if d2 < best_d2:
                best_d2 = d2
                best_proj = proj
        if best_proj is not None:
            obs[18] = (best_proj.x - p_x) / _REL_NORM  # type: ignore[union-attr]
            obs[19] = (best_proj.y - p_y) / _REL_NORM  # type: ignore[union-attr]
            obs[20] = _clip1((best_proj.vx - p_vx) / _VEL_NORM)  # type: ignore[union-attr]
            obs[21] = _clip1((best_proj.vy - p_vy) / _VEL_NORM)  # type: ignore[union-attr]

        obs[22] = world.combo / float(COMBO_MAX)
        obs[23] = min(world.wave, 12) / _WAVE_NORM
        return obs
