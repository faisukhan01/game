# Contributing to VOIDSTRIKE

## Ground rules

1. **`docs/PROTOCOL.md` is law.** Any change to simulation constants or tick
   order must (a) update the doc, (b) bump the protocol string, (c) regenerate
   golden vectors, (d) update every port. CI fails on mismatch.
2. **Determinism is sacred.** No `Math.random`, no wall-clock, no float
   `round()` (use `floor(v*1000+0.5)` quantization), no platform trig beyond
   IEEE `cos`/`sin` in the deterministic path.
3. **Tests gate merges.** Each component's CI job must stay green:
   `core-c`, `gameserver` (race detector on), `mlops`, `web` (lint + build),
   `leaderboard-java`, `flutter`.

## Local setup

```bash
make core          # C core + conformance tests
make golden        # regenerate golden vectors
make test-server   # Go vet + race tests
make test-mlops    # pytest
make test-java     # mvn test
bun install && bun run lint   # web client
```

## Commits

Conventional commits (`feat:`, `fix:`, `perf:`, `chore:`), imperative mood.
PRs include a short **what/why** and call out any protocol impact.
