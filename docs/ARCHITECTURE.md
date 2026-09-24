# VOIDSTRIKE — Architecture

## 1. Determinism spine

```
core/c (C99 reference, libvoidstrike)
   │  make golden → testdata/golden/ticks.json
   ├── services/gameserver  (Go)      golden_test.go      ✓ 50/50
   ├── services/mlops       (Python)  test_golden_vectors ✓ 50/50
   └── clients/unity        (C#)      Voidstrike.Core.Tests ✓ (CI)
```

- One `splitmix64` stream per world; consumption order is contractual
  (bot AI ascending id → patrol draws → fire jitter → player spread).
- Quantization `floor(v*1000 + 0.5)` — identical in every language; `round()`
  is banned (banker's rounding divergence).
- `dt` is the literal `0.016666666666666666` everywhere.

## 2. Runtime topology

| Service | Runtime | State | Scaling |
|---|---|---|---|
| Web client | Next.js 16 (Node) | Prisma/SQLite (dev) → Postgres (prod) | edge/VM, stateless |
| Gameserver | Go 1.22 | in-memory rooms (authoritative) | horizontal per-region, HPA |
| Live-ops | Java 21, Spring Boot | JPA (H2 dev / Postgres prod) | stateless replicas |
| MLOps | Python 3.12 batch jobs | model registry (filesystem/S3) | on-demand (CI/cron) |

## 3. Netcode model

- Client → server: last-wins intent inputs (`move`, `aim`, `fire`, `dash`,
  `nova`) — never positions.
- Server: 60Hz authoritative sim per room; 20Hz snapshot broadcast.
- Room lifecycle: ≤ 8 seats, 5:00 or 25 kills, finished+empty rooms reaped.
- Determinism makes server reconciliation trivial: any client can resim any
  tick from `seed + input history`.

## 4. Anti-fraud pipeline

1. Web/Java `score_max = 5000 + kills*500 + wave*400 + duration*2` ceiling.
2. Java service flags > 3× personal best / > 10× running average.
3. Deterministic replay: matches record `seed` + inputs; the server can
   resimulate and verify (roadmap: sampled replay verification fleet).

## 5. MLOps loop

```
telemetry JSONL → pandas KPIs → difficulty director knobs
                     │
VoidstrikeEnv ──► train (tabular-Q || DQN) ──► eval gate
                     │                                │
                     └──► registry (rules_hash-pinned) │
                              │                        │
                              ▼                        ▼
                        gameserver bots      promote / roll back
```

## 6. Failure modes & mitigations

| Risk | Mitigation |
|---|---|
| Desync across languages | golden vectors in CI (hard fail) |
| Slow WS client stalls room | per-client drop policy (non-blocking Send) |
| Score inflation | ceiling + statistical flags + replay verification |
| Model drift poisons PvE | promotion gate + registry hash pinning + rollback |
| Room goroutine leak | context-driven lifecycle, janitor reaping, race-tested |
