# VOIDSTRIKE Gameserver (Go)

Authoritative 60Hz simulation server for **Versus** deathmatch, implementing
`docs/PROTOCOL.md` v1. Validated tick-for-tick against the C reference core
via `testdata/golden/ticks.json`.

## Architecture

```
cmd/server          — binary: HTTP mux, graceful shutdown, slog JSON logs
cmd/demo-bot        — headless client for smoke tests / CI soak
internal/sim        — deterministic Protocol v1 sim (golden-tested)
internal/room       — room registry, 60Hz tick loop, 20Hz snapshots, last-wins inputs
internal/httpapi    — WebSocket transport (/ws), health endpoints, Prometheus metrics
internal/config     — env-driven configuration
```

## Run

```bash
make run            # builds + starts on :3002
make test           # go test -race ./... (golden vectors auto-skip if absent)
make vet
```

Endpoints:

| Route | Purpose |
|---|---|
| `GET /ws` | WebSocket (hello → welcome → input/snapshot frames, PROTOCOL §8) |
| `GET /healthz` | liveness JSON |
| `GET /readyz` | readiness (room capacity check) |
| `GET /metrics` | Prometheus registry |

## Conformance

`internal/sim/golden_test.go` replays the C-generated golden vectors
(5 seeds × 600 ticks, checksum every 60). A mismatch fails CI; a missing
file skips — always generate with `make -C ../../core/c golden` first.

## Configuration

`PORT` (3002) · `TICK_RATE` (60) · `SNAPSHOT_HZ` (20) · `MAX_ROOMS` (64) · `LOG_LEVEL` (info)

## Room model

- ≤ 8 players per room, first seat drives sim entity 0 (last-wins input).
- Versus ends at 5:00 or 25 kills; finished, empty rooms are reaped.
- Bots: seats are human-driven; PvE difficulty policies come from the
  MLOps registry (`services/mlops`) via `internal/bots` loader.
