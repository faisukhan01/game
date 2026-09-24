"""Evaluation harness: policy vs scripted baseline with a promotion gate."""

from __future__ import annotations

import argparse
import json
import statistics

from .env import VoidstrikeEnv
from .registry import load_policy


def run_episode(env: VoidstrikeEnv, policy, seed: int, use_policy: bool) -> dict:
    env.reset(seed)
    done = False
    total = 0.0
    score = 0
    wave = 1
    while not done:
        if use_policy and policy is not None:
            action = policy.act(env._obs(), eps=0.0)
        else:
            action = env.scripted_action()
        _, reward, done, info = env.step(action)
        total += reward
        score += info.get("score", 0)
        wave = info.get("wave", wave)
    return {"return": round(total, 3), "score": int(score), "wave": wave}


def evaluate(policy_path: str | None, episodes: int = 20, seed_base: int = 9000) -> dict:
    agent = None
    if policy_path:
        agent, _manifest = load_policy(policy_path.split("/")[-1])

    env = VoidstrikeEnv()
    pol = [run_episode(env, agent, seed_base + i, use_policy=True) for i in range(episodes)]
    base = [run_episode(env, None, seed_base + 1000 + i, use_policy=False) for i in range(episodes)]

    pol_avg = statistics.mean(p["return"] for p in pol)
    base_avg = statistics.mean(b["return"] for b in base)
    result = {
        "policy_avg_return": round(pol_avg, 3),
        "baseline_avg_return": round(base_avg, 3),
        "policy_avg_score": round(statistics.mean(p["score"] for p in pol), 1),
        "baseline_avg_score": round(statistics.mean(b["score"] for b in base), 1),
        "episodes": episodes,
        "gate_pass": pol_avg >= 0.8 * base_avg,
    }
    return result


def main() -> None:
    ap = argparse.ArgumentParser(prog="botlab eval")
    ap.add_argument("--policy", default=None, help="registry name or path")
    ap.add_argument("--episodes", type=int, default=20)
    args = ap.parse_args()
    print(json.dumps(evaluate(args.policy, args.episodes), indent=2))


if __name__ == "__main__":
    main()
