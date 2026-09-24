# libvoidstrike — Deterministic Engine Core (C99, Protocol v1)

The **reference implementation** of the VOIDSTRIKE simulation. Every other
port (Go, TypeScript, C#, C++, Dart, Python) is validated against this core
via `testdata/golden/ticks.json`.

## Build & Test

```bash
make all      # libvoidstrike.a + libvoidstrike.so (build/)
make test     # conformance suite: RNG known-answer, FNV vectors, determinism, collision, perf
make golden   # regenerate testdata/golden/ticks.json (byte-stable)
make clean
```

Zero dependencies. Compiles clean under `-std=c99 -Wall -Wextra -Werror -O2`.

## API

```c
#include <voidstrike/world.h>
#include <voidstrike/checksum.h>

vs_world w;
vs_world_init(&w, seed);          // player at (800,300), wave 1 queued
vs_world_tick(&w, &input);        // one fixed tick, dt = 1/60
uint64_t cs = vs_world_checksum(&w);
```

Types in `include/voidstrike/types.h`, RNG (`splitmix64`) in `rng.h`,
FNV-1a 64 + canonical quantization in `checksum.h`.

## Determinism contract

- `dt` is the literal `0.016666666666666666` — never recompute `1.0/60.0`.
- One shared `splitmix64` stream per world. Consumption order per tick:
  per bot (ascending id): orbit-sign draw (STRAFE/ATTACK entry) → patrol
  waypoint draws (x, then y) → fire jitter draw; then player spread draw.
- Quantization for checksums: `(int64) floor(v * 1000 + 0.5)` — identical
  across languages (`floor`, never `round`).
- Checksum covers **units only** (player + bots, ascending id, dead included),
  then `u32 count, i64 score, u32 wave, u64 rules_hash`.

## Scripted player — "wave-survival-default"

Used by the golden generator and all conformance tests:

- Waypoints cycle every 120 ticks: `(400,250) → (1200,250) → (1200,650) → (400,650)`;
  move toward waypoint, idle within 20u.
- Fire every tick at the nearest alive bot (aim `(1,0)` when none).
- Dash when ready **and** nearest bot < 150u (dash dir = away from it).
- Nova when energy ≥ 55 **and** ≥ 2 bots within 210u.

## Layout

```
include/voidstrike/{types,rng,checksum,world}.h
src/{rng,checksum,world}.c
tests/test_main.c        # 10k+ assertions, all green
scripts/gen_golden.c     # golden vector producer
```
