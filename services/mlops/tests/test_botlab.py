"""Registry + environment + telemetry tests."""

from __future__ import annotations

import json
import os

import numpy as np
import pytest

from botlab.dqn import TabularQAgent
from botlab.env import N_ACTIONS, OBS_DIM, VoidstrikeEnv
from botlab.rules import rules_hash


def test_env_shapes_and_determinism() -> None:
    e1, e2 = VoidstrikeEnv(seed=7), VoidstrikeEnv(seed=7)
    o1, o2 = e1.reset(), e2.reset()
    assert o1.shape == (OBS_DIM,)
    assert np.array_equal(o1, o2)
    for _ in range(120):
        a1, r1, d1, _ = e1.step(5)
        a2, r2, d2, _ = e2.step(5)
        assert np.array_equal(a1, a2)
        assert r1 == r2
        if d1 or d2:
            break


def test_env_episode_runs() -> None:
    env = VoidstrikeEnv(seed=3)
    env.reset()
    done = False
    steps = 0
    while not done and steps < 1800:
        _, _, done, info = env.step(env.scripted_action())
        steps += 1
    assert steps > 0
    assert info["wave"] >= 1


def test_registry_roundtrip(tmp_path: str) -> None:
    import botlab.registry as reg

    reg.REGISTRY_ROOT = str(tmp_path)
    agent = TabularQAgent(n_actions=N_ACTIONS)
    agent.table[42] = np.ones(N_ACTIONS, dtype=np.float32) * 0.5
    metrics = {"avg_return_last20": 1.23, "episodes": 3}
    reg.save_policy("test_policy", agent, metrics)
    loaded, manifest = reg.load_policy("test_policy")
    assert manifest["rules_hash"] == f"0x{rules_hash():016x}"
    assert manifest["protocol"] == "v1"
    assert np.allclose(loaded.table[42], agent.table[42])
    # mismatching rules_hash must be refused
    mp = os.path.join(str(tmp_path), "test_policy", "manifest.json")
    with open(mp, encoding="utf-8") as f:
        bad = json.load(f)
    bad["rules_hash"] = "0xdeadbeefdeadbeef"
    with open(mp, "w", encoding="utf-8") as f:
        json.dump(bad, f)
    with pytest.raises(ValueError, match="rules_hash mismatch"):
        reg.load_policy("test_policy")


def test_telemetry_pipeline() -> None:
    from botlab.telemetry import ingest, kpis, report

    sample = os.path.join(os.path.dirname(__file__), "..", "sample_data",
                          "matches_sample.jsonl")
    if not os.path.exists(sample):
        pytest.skip("sample data not generated yet")
    df = ingest(sample)
    k = kpis(df)
    assert k["unique_callsigns"] > 0
    assert "wave_difficulty_curve" in k
    out = report(df, out_dir=os.path.join(os.path.dirname(__file__), "..", "reports"))
    assert os.path.exists(os.path.join(os.path.dirname(__file__), "..", "reports", "summary.md"))
    assert out["median_score"] >= 0
