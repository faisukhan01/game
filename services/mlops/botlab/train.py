"""Training CLI: botlab train --timesteps N --seed S --out NAME."""

from __future__ import annotations

import argparse
import json
import time

from .env import VoidstrikeEnv
from .registry import save_policy


def make_agent(algo: str):
    if algo == "dqn":
        try:
            import torch  # noqa: F401
            from .dqn import DQNAgent
            agent = DQNAgent()
            agent.algo_name = "dqn"
            return agent, "dqn"
        except ImportError:
            pass
    from .dqn import TabularQAgent
    agent = TabularQAgent()
    agent.algo_name = "tabular_q"
    return agent, "tabular_q"


def train(timesteps: int, seed: int, out: str, algo: str) -> dict:
    agent, framework = make_agent(algo)
    env = VoidstrikeEnv(seed=seed)
    obs = env.reset(seed)

    log_path = f"{out}/train_log.jsonl" if "/" in out else None
    log_f = None
    if log_path:
        import os
        os.makedirs(out, exist_ok=True)
        log_f = open(log_path, "w", encoding="utf-8")

    episode_returns: list[float] = []
    ep_return = 0.0
    transitions: list = []
    t0 = time.time()
    batch: list = []

    for t in range(1, timesteps + 1):
        action = agent.act(obs)
        next_obs, reward, done, info = env.step(action)
        batch.append((obs, action, float(reward), next_obs, bool(done)))
        ep_return += float(reward)

        if len(batch) >= 32:
            agent.observe(batch)
            batch = []

        obs = next_obs
        if done:
            env.reset(seed + t)
            episode_returns.append(ep_return)
            ep_return = 0.0
            obs = env._obs()

        if log_f and t % 500 == 0:
            recent = episode_returns[-20:] or [0.0]
            rec = {"t": t, "eps": getattr(agent, "eps", 0.0),
                   "avg_return": sum(recent) / len(recent),
                   "table_size": len(getattr(agent, "table", {}) or {})}
            log_f.write(json.dumps(rec) + "\n")
            log_f.flush()

    if batch:
        agent.observe(batch)
    if log_f:
        log_f.close()

    elapsed = time.time() - t0
    recent = episode_returns[-20:] or [0.0]
    metrics = {
        "avg_return_last20": round(sum(recent) / len(recent), 4),
        "episodes": len(episode_returns),
        "timesteps": timesteps,
        "wall_sec": round(elapsed, 1),
        "framework": framework,
    }
    save_policy(out if "/" not in out else out.rstrip("/").split("/")[-1],
                agent, metrics, extra={"seed": seed})
    return metrics


def main() -> None:
    ap = argparse.ArgumentParser(prog="botlab train")
    ap.add_argument("--timesteps", type=int, default=20000)
    ap.add_argument("--seed", type=int, default=1337)
    ap.add_argument("--out", required=True, help="registry name or path")
    ap.add_argument("--algo", choices=["auto", "dqn", "tabular"], default="auto")
    args = ap.parse_args()
    metrics = train(args.timesteps, args.seed, args.out, args.algo)
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
