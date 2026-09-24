<div align="center">

# VOIDSTRIKE
### Arena Protocol

**Drop in. Lock on. Leave nothing.**

A cross-platform, server-authoritative top-down arena shooter with MLOps-trained
combat bots, ranked seasons, and one deterministic simulation core shared by
nine platform targets.

`PROTOCOL v1` · `rules_hash 0xbfb4742570daa8fb`

[![ci](https://github.com/faisukhan01/game/actions/workflows/ci.yml/badge.svg)](https://github.com/faisukhan01/game/actions/workflows/ci.yml)
![ platforms ](https://img.shields.io/badge/platforms-9-8A939E)
![ tick rate ](https://img.shields.io/badge/tick%20rate-60Hz-C8F31D)

</div>

---

## The one idea

Every implementation of the game — C, Go, TypeScript, C#, C++, Dart, Python —
evolves **bit-identical state** from the same seed and inputs. The C core is
the reference; every other port is locked to it with **golden-vector
checksums** (FNV-1a 64 over quantized state, sampled every 60 ticks). Netcode
teams will recognize what this buys: rollback without desyncs, replay files
that never lie, and bots trained in an environment that *is* the live game.

```
core/c (reference) ──► testdata/golden/ticks.json
        │                      │
        ▼                      ▼
  Go server ✓  ✓ TS web client  ✓ C# core (Unity)   ✓ Python botlab
```

## Monorepo

| Path | Stack | What it is |
|---|---|---|
| **`/`** (apps/web) | Next.js 16, Canvas, Prisma | **Playable web client** — marketing site + live Onslaught mode + leaderboards |
| **`core/c/`** | C99 | `libvoidstrike` — deterministic engine core, 10k+ conformance checks, golden vector producer |
| **`services/gameserver/`** | Go | Authoritative 60Hz Versus server: rooms, WebSocket netcode, 20Hz snapshots, Prometheus metrics, race-tested |
| **`services/mlops/`** | Python | `botlab` — RL training (tabular-Q / DQN), promotion gates, versioned registry, telemetry ETL. **Ships a trained policy that beats the scripted baseline 540 vs 368 avg score** |
| **`services/leaderboard/`** | Java 21, Spring Boot | Live-ops: seasons, ladder aggregation, anti-fraud score validation (Protocol §10) |
| **`mobile/flutter_app/`** | Flutter + Flame | iOS/Android client: fixed-step sim, twin-stick touch controls |
| **`mobile/android_companion/`** | Kotlin, Compose | Stats/ladder companion app (Retrofit + kotlinx-serialization) |
| **`clients/unity/`** | Unity 2022.3, C# | PC/console client — local package shares the C# core; scene built programmatically from source |
| **`clients/unreal/`** | UE5, C++ | `VoidstrikeArena` module: fixed-step sim subsystem, replication-ready snapshot codec |

## Quickstart

```bash
# 1. The deterministic core — 10,023 assertions
make core

# 2. Play in the browser
bun install && bun run db:push && bun run dev   # http://localhost:3000

# 3. The authoritative server
cd services/gameserver && go build -o bin/server ./cmd/server && ./bin/server  # :3002
cd services/gameserver && ./bin/demo-bot                                       # live smoke client

# 4. Train + evaluate a combat bot (CPU, ~1 min)
cd services/mlops && make venv train eval
```

## Architecture

```
                    ┌───────────────────────────────────────┐
                    │            clients (9 targets)        │
                    │  web · flutter · unity · unreal · …   │
                    └──────────────┬────────────────────────┘
                                   │ WSS (JSON frames, Protocol §8)
                    ┌──────────────▼──────────────┐
                    │   Go gameserver (60Hz auth) │──► Prometheus / Grafana
                    │   rooms · bots · snapshots  │
                    └──────┬──────────────┬───────┘
                           │              │ difficulty policies
                ┌──────────▼──────┐  ┌────▼──────────────────┐
                │ Java live-ops   │  │ Python botlab (MLOps) │
                │ ladder · fraud  │  │ train → gate → registry│
                └─────────────────┘  └───────────────────────┘
```

Details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) ·
[`docs/PROTOCOL.md`](docs/PROTOCOL.md) · [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md) ·
[`docs/API_REFERENCE.md`](docs/API_REFERENCE.md) · [`docs/MLOPS.md`](docs/MLOPS.md) ·
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

## Engineering highlights

- **Golden-vector conformance** — C generates `testdata/golden/ticks.json`
  (5 seeds × 600 ticks); Go, Python and C# suites fail hard on any mismatch.
  Cross-language determinism is *proven in CI*, not hoped for.
- **Server authority** — the Go server owns every tick; clients send last-wins
  intent inputs only. Score submissions pass a physics-plausibility ceiling
  before they touch the ladder.
- **MLOps with a real gate** — policies train against the exact live sim,
  must beat the scripted baseline, and are `rules_hash`-pinned: the server
  refuses mismatched models at load time.
- **Production plumbing** — multi-stage distroless Dockerfiles, kustomize
  K8s manifests with HPA, Prometheus alerting, gitleaks, conventional CI
  across seven toolchains.

## Platform matrix

| Platform | Client | Mode | Status |
|---|---|---|---|
| Browser | Next.js + Canvas | Onslaught + leaderboards | **LIVE** |
| PC / Console | Unity (C#) | Onslaught + Versus | cert-ready, GameCI pipeline |
| PC / Console | Unreal (C++) | sim module | UBT pipeline |
| iOS / Android | Flutter (Dart) | Onslaught | flight pilot |
| Companion | Kotlin Compose | stats / ladder | flight pilot |

## License

Proprietary — © 2026 VOIDSTRIKE STUDIOS. All rights reserved. See [LICENSE](LICENSE).
