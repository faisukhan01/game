# VOIDSTRIKE — MLOps Handbook

## Why bots trained here are special

`botlab.rules.World` is a line-faithful port of the C reference core. Golden
vectors prove the training environment **is** the live game — policies are not
simmered in an approximation and then dropped into production; they are trained
in production's twin.

## Pipeline

1. **Telemetry** — match events land as JSONL (`docs/GAME_DESIGN.md §7`).
2. **ETL** — `botlab ingest` computes DAI, session length, difficulty curve,
   ability usage; `botlab report` writes CSV + markdown for the design team.
3. **Training** — `VoidstrikeEnv` (24-dim obs, Discrete(27)) + tabular-Q
   (compact 1024-state encoder) or torch DQN (auto-detected).
4. **Gate** — `botlab eval` runs N episodes vs the scripted baseline;
   policy must score ≥ 0.8 × baseline to promote.
5. **Registry** — `models/registry/<name>/{policy.bin,manifest.json}`;
   manifest pins `rules_hash`, seed, metrics. Loader refuses mismatches.

## Shipped artifact

```
$ botlab eval --policy bot_policy_v1 --episodes 20
policy_avg_return:  4.891     baseline_avg_return:  1.362
policy_avg_score:   539.9     baseline_avg_score:   367.9
gate_pass: true
```

Trained: 500k Protocol-v1 ticks, seed 1337, wall ~53s on CPU (numpy path).

## Season workflow

```bash
make train-bot        # new candidate per season with fresh telemetry priors
botlab eval ...       # gate
botlab list           # compare manifests
# promote: copy to gameserver models/ dir → rolling restart
```

## Extending

- New reward terms: `botlab/env.py` (keep shaping documented).
- New observation features: extend `_obs()`; keep the discretizer compact —
  tabular Q needs ~15 visits per (state, action).
- Bigger models: `pip install ".[torch]"` — the DQN path shares the interface.
