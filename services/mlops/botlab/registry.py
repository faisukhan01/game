"""Model registry — versioned policy artifacts with manifests.

Layout: models/registry/<name>/{policy.bin, manifest.json}
The manifest carries rules_hash so the gameserver refuses mismatched models.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any

from . import PROTOCOL
from .rules import rules_hash

REGISTRY_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                             "models", "registry")


def save_policy(name: str, agent: Any, metrics: dict[str, Any],
                extra: dict[str, Any] | None = None) -> str:
    out_dir = os.path.join(REGISTRY_ROOT, name)
    os.makedirs(out_dir, exist_ok=True)
    agent.save(os.path.join(out_dir, "policy.bin"))
    manifest = {
        "name": name,
        "algo": getattr(agent, "algo_name", "tabular_q"),
        "protocol": PROTOCOL,
        "rules_hash": f"0x{rules_hash():016x}",
        "eval_metrics": metrics,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "artifact": "policy.bin",
    }
    if extra:
        manifest.update(extra)
    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    return out_dir


def load_policy(name: str) -> tuple[Any, dict[str, Any]]:
    out_dir = os.path.join(REGISTRY_ROOT, name)
    manifest_path = os.path.join(out_dir, "manifest.json")
    if not os.path.exists(manifest_path):
        raise FileNotFoundError(f"policy {name!r} not found in registry")
    with open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)
    if manifest.get("rules_hash") != f"0x{rules_hash():016x}":
        raise ValueError(f"policy {name!r} rules_hash mismatch — refusing to load")

    algo = manifest.get("algo", "tabular_q")
    if algo == "dqn":
        from .dqn import DQNAgent
        agent = DQNAgent()
    else:
        from .dqn import TabularQAgent
        agent = TabularQAgent()
    agent.load(os.path.join(out_dir, "policy.bin"))
    return agent, manifest


def list_policies() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not os.path.isdir(REGISTRY_ROOT):
        return out
    for name in sorted(os.listdir(REGISTRY_ROOT)):
        mf = os.path.join(REGISTRY_ROOT, name, "manifest.json")
        if os.path.exists(mf):
            with open(mf, encoding="utf-8") as f:
                out.append(json.load(f))
    return out
