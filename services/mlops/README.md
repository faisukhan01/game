# VOIDSTRIKE botlab (Python MLOps)

RL training pipeline for combat bots, model registry, and telemetry ETL —
all built on the **exact live simulation** (Protocol v1 port, golden-vector
conformance tested against the C core).

## Architecture

```
telemetry JSONL ──► ingest ──► pandas KPIs ──► reports/ (CSV + markdown)
                                   │
                                   ▼  difficulty director (season tuning)
VoidstrikeEnv (Protocol v1) ──► train (tabular Q / DQN auto-detect)
                                   │
                                   ▼ eval gate: policy ≥ 0.8 × baseline
                            models/registry/<name>/{policy.bin, manifest.json}
                                   │  (rules_hash verified at load)
                                   ▼
                     gameserver internal/bots (difficulty policies)
```

## Quickstart

```bash
make venv      # .venv + deps (numpy, pandas, pytest; torch optional)
make test      # conformance + env + registry + ETL suites
make train     # 500k tabular-Q steps → models/registry/bot_policy_v1
make eval      # promotion gate vs scripted baseline
make report    # KPI report from sample_data
```

## Shipped artifact

`models/registry/bot_policy_v1` — trained on 500k Protocol-v1 ticks:

| Metric | Policy | Scripted baseline |
|---|---|---|
| Avg return | **4.89** | 1.36 |
| Avg score | **540** | 368 |

Gate (`policy ≥ 0.8 × baseline`): **PASS**. Manifest carries `rules_hash`
`0xbfb4742570daa8fb` — the gameserver refuses mismatched models.

## Design notes

- **Determinism**: the env is a line-faithful port of `core/c` (same splitmix64
  stream, same tick order). Same seed + actions → bit-identical checksums.
- **State encoding**: 1024-state code (nearest-bot distance/side, hp, energy,
  dash readiness). Deliberately compact — tabular Q needs ~15 visits per
  (state, action) pair to converge.
- **Torch optional**: DQN path activates automatically if `torch` installs;
  otherwise tabular Q trains in ~1 minute on CPU. Both share one interface.
- **Registry safety**: mismatched `rules_hash` → `ValueError` at load.
