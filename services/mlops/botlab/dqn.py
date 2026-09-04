"""Tabular Q agent (numpy) — production fallback when torch is unavailable.

Interface is DQN-compatible: act / observe / save / load.
State is discretized into a compact grid over the 24-dim observation.
"""

from __future__ import annotations

import json
import os

import numpy as np

# discretization bins per feature group (must keep table < 2MB for registry)
BINS = np.array([16, 12, 8, 8, 8, 8, 4, 5, 10,   # self
                 8, 8, 4, 4, 8, 8, 4, 4, 8, 8, 4, 4,  # 3 bots rel
                 8, 8, 4], dtype=np.int64)            # nearest projectile


def _discretize(obs: np.ndarray) -> int:
    """Compact, task-focused state code (1024 states) from the 24-dim obs.

    Features: nearest-bot distance bucket & side, hp, energy, dash readiness.
    Deliberately tiny: tabular Q needs ~15+ visits per (state, action), so a
    small state space beats a rich one at this step budget.
    """
    d_near = float(np.hypot(obs[9] * 1600.0, obs[10] * 900.0))    # 0..~1900
    dist_b = int(min(7, d_near // 240))                           # 8 buckets
    side_b = 1 if obs[9] >= 0 else 0                              # 2
    hp_b = int(min(3, obs[4] * 4))                                # 4
    en_b = int(min(3, obs[5] * 4))                                # 4
    dash_b = 1 if obs[6] < 0.1 else 0                             # 2

    code = 0
    for v in (dist_b, hp_b, en_b, dash_b, side_b):
        code = code * 8 + v
    return code


class TabularQAgent:
    """Epsilon-greedy tabular Q-learning with decaying exploration."""

    def __init__(self, n_actions: int = 27, lr: float = 0.3,
                 gamma: float = 0.97, eps: float = 1.0,
                 eps_min: float = 0.05, eps_decay: float = 0.9999) -> None:
        self.n_actions = n_actions
        self.lr = lr
        self.gamma = gamma
        self.eps = eps
        self.eps_min = eps_min
        self.eps_decay = eps_decay
        self.rng = np.random.default_rng(0)
        self.table: dict[int, np.ndarray] = {}
        self._pending: list[tuple[int, int, float, bool]] = []

    def _q(self, state: int) -> np.ndarray:
        q = self.table.get(state)
        if q is None:
            q = np.zeros(self.n_actions, dtype=np.float32)
            self.table[state] = q
        return q

    def act(self, obs: np.ndarray, eps: float | None = None) -> int:
        e = self.eps if eps is None else eps
        if self.rng.random() < e:
            return int(self.rng.integers(self.n_actions))
        return int(np.argmax(self._q(_discretize(obs))))

    def observe(self, transitions: list[tuple[np.ndarray, int, float, np.ndarray, bool]]) -> None:
        for obs, action, reward, next_obs, done in transitions:
            s, s2 = _discretize(obs), _discretize(next_obs)
            target = reward + (0.0 if done else self.gamma * float(np.max(self._q(s2))))
            q = self._q(s)
            q[action] += self.lr * (target - q[action])
        self.eps = max(self.eps_min, self.eps * self.eps_decay)

    # -- persistence --
    def save(self, path: str) -> None:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        data = {str(k): v.tolist() for k, v in self.table.items()}
        meta = {"algo": "tabular_q", "n_actions": self.n_actions, "eps": self.eps,
                "lr": self.lr, "gamma": self.gamma, "bins": BINS.tolist()}
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"meta": meta, "table": data}, f)

    def load(self, path: str) -> None:
        with open(path, encoding="utf-8") as f:
            blob = json.load(f)
        meta = blob["meta"]
        self.n_actions = int(meta["n_actions"])
        self.eps = float(meta.get("eps", 0.05))
        self.table = {int(k): np.array(v, dtype=np.float32) for k, v in blob["table"].items()}

    @property
    def size_bytes(self) -> int:
        return sum(v.nbytes for v in self.table.values()) + len(self.table) * 64


class DQNAgent:
    """Torch DQN — used automatically when torch is importable at train time."""

    def __init__(self, obs_dim: int = 24, n_actions: int = 27,
                 lr: float = 1e-3, gamma: float = 0.99,
                 eps: float = 1.0, eps_min: float = 0.05,
                 eps_decay: float = 0.99995, device: str = "cpu") -> None:
        import torch  # noqa: PLC0415 — lazy, optional
        import torch.nn as nn  # noqa: PLC0415

        self.torch = torch
        self.n_actions = n_actions
        self.gamma = gamma
        self.eps = eps
        self.eps_min = eps_min
        self.eps_decay = eps_decay
        self.rng = np.random.default_rng(0)

        def net() -> nn.Module:
            return nn.Sequential(
                nn.Linear(obs_dim, 128), nn.ReLU(),
                nn.Linear(128, 128), nn.ReLU(),
                nn.Linear(128, n_actions),
            )

        self.online = net().to(device)
        self.target = net().to(device)
        self.target.load_state_dict(self.online.state_dict())
        self.opt = torch.optim.Adam(self.online.parameters(), lr=lr)
        self.memory: list[tuple[np.ndarray, int, float, np.ndarray, bool]] = []
        self.batch = 64
        self._updates = 0

    def act(self, obs: np.ndarray, eps: float | None = None) -> int:
        e = self.eps if eps is None else eps
        if self.rng.random() < e:
            return int(self.rng.integers(self.n_actions))
        with self.torch.no_grad():
            t = self.torch.as_tensor(obs, dtype=self.torch.float32).unsqueeze(0)
            return int(self.online(t).argmax(dim=1).item())

    def observe(self, transitions: list[tuple[np.ndarray, int, float, np.ndarray, bool]]) -> None:
        import torch  # noqa: PLC0415

        self.memory.extend(transitions)
        self.eps = max(self.eps_min, self.eps * self.eps_decay)
        if len(self.memory) < self.batch:
            return
        idx = self.rng.choice(len(self.memory), size=self.batch, replace=False)
        batch = [self.memory[i] for i in idx]
        obs = torch.as_tensor(np.stack([b[0] for b in batch]))
        act = torch.as_tensor([b[1] for b in batch])
        rew = torch.as_tensor([b[2] for b in batch])
        nxt = torch.as_tensor(np.stack([b[3] for b in batch]))
        done = torch.as_tensor([b[4] for b in batch], dtype=torch.bool)

        q = self.online(obs).gather(1, act.unsqueeze(1)).squeeze(1)
        with torch.no_grad():
            q_next = self.target(nxt).max(dim=1).values
            q_next[done] = 0.0
        loss = torch.nn.functional.smooth_l1_loss(q, rew + self.gamma * q_next)
        self.opt.zero_grad()
        loss.backward()
        self.opt.step()
        self._updates += 1
        if self._updates % 200 == 0:
            self.target.load_state_dict(self.online.state_dict())

    def save(self, path: str) -> None:
        import torch  # noqa: PLC0415

        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        torch.save({"online": self.online.state_dict(), "meta": {
            "algo": "dqn", "n_actions": self.n_actions, "obs_dim": 24, "eps": self.eps,
        }}, path)

    def load(self, path: str) -> None:
        import torch  # noqa: PLC0415

        blob = torch.load(path, map_location="cpu", weights_only=False)
        self.n_actions = int(blob["meta"]["n_actions"])
        self.eps = float(blob["meta"].get("eps", 0.05))
        self.online.load_state_dict(blob["online"])
        self.target.load_state_dict(blob["online"])
