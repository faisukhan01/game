# VOIDSTRIKE — Deterministic Simulation Protocol v1

> **This document is the single source of truth for game simulation rules.**
> Every implementation — C core, Go server, TypeScript web client, C# core
> (Unity), Unreal C++ module, Flutter/Dart client, Python MLOps environment —
> MUST produce identical state evolution given identical inputs and seed.
>
> Conformance is enforced by **golden vectors**: `testdata/golden/ticks.json`.

---

## 1. Rules Hash

```
rules_hash = FNV1a64("VOIDSTRIKE_SIM_V1")
```

All snapshots, replays, model manifests and match records carry `rules_hash`.
Mismatched implementations MUST refuse to interoperate.

## 2. World & Ticking

| Constant | Value |
|---|---|
| World size | `1600 × 900` units (origin top-left, +y down) |
| Tick rate | `60` Hz |
| dt | `0.016666666666666666` (precomputed literal `1.0/60.0` — never recompute) |
| Entity ids | `u32`, ascending assignment, player always id 0 |

Entities: **player/bot** (circles), **projectiles** (circles), **obstacles** (static AABBs).

### Obstacles (AABB: x, y, w, h)
```
[200, 150, 220, 40]  [1180, 150, 220, 40]  [200, 710, 220, 40]
[700, 420, 200, 60]  [1180, 710, 220, 40]
```

### Spawn points (8 fixed, edge) `[x, y]`
```
[80, 80] [1520, 80] [80, 820] [1520, 820]
[800, 40] [800, 860] [40, 450] [1560, 450]
```

## 3. Constants (authoritative)

```yaml
player:
  radius: 14
  max_hp: 100
  speed: 260            # units/sec
  energy_max: 100
  energy_regen_per_sec: 14
  dash_cooldown_sec: 3.0
  dash_impulse: 720     # instant velocity add along dash dir

rifle:
  fire_interval_sec: 0.1
  projectile_radius: 4
  projectile_speed: 560
  damage: 10
  spread_deg: 2.0       # symmetric uniform, RNG stream
  lifetime_sec: 1.2
  energy_cost: 2

nova:
  energy_cost: 55
  radius: 210
  damage: 48
  knockback: 420        # instant velocity add away from center

bot:                    # wave n is 1-indexed
  radius: 14
  hp:            "min(30 + 8n, 90)"
  speed:         "min(150 + 6n, 240)"
  damage: 8
  fire_interval_sec: 0.85
  projectile_speed: 480
  projectile_lifetime_sec: 1.6
  aim_jitter_deg: "max(3.0, 12.0 - 0.5n)"
  count_per_wave: "3 + 2n"
  spawn_stagger_sec: 0.4

scoring:
  kill:            "100 * combo"     # combo window 3.0s, multiplier 1..5
  wave_bonus:      "250 + 50n"
  survival_per_sec: 1
```

## 4. Randomness — `splitmix64`

Single shared stream per world. **Consumed in deterministic order**: bot AI in
ascending entity id, then effect jitter.

```
state u64 (init = seed)
next():
  state += 0x9E3779B97F4A7C15
  z = state
  z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9   (mod 2^64)
  z = (z ^ (z >> 27)) * 0x94D049BB133111EB   (mod 2^64)
  return z ^ (z >> 27)
uniform01(): next() / 2^64
```

Arithmetic: **float64 only**. Allowed math: `+ - * / sqrt min max abs floor`.
`cos`/`sin` are the ONLY transcendentals permitted (IEEE 754, double precision).
Rotation of vector `(x, y)` by angle `a`: `(x·cos a − y·sin a, x·sin a + y·cos a)`.

## 5. Tick Order (fixed, per tick)

1. **Timers**: dash cooldowns, fire cooldowns, combo timer, wave spawn queue.
2. **Movement** (player + bots, ascending id): `target = input_dir * speed`;
   `vel += (target − vel) * 0.2`; dash triggered → `vel += dash_dir * dash_impulse`;
   `pos += vel * dt`. Bots always emit an input dir (FSM §6).
3. **World resolve**: circle-vs-AABB push-out (clamp center to box; if dist < r,
   push along normal; if center inside box, push to nearest edge, zero that axis vel).
4. **Firing**: pressed && `fire_cd ≤ 0` && `energy ≥ cost` → spawn projectile:
   dir = aim dir rotated by jitter (bots) or spread (player, uniform ±2°),
   `energy −= cost`, `fire_cd = interval`. Projectile spawns at entity center
   + dir * (r + 6).
5. **Projectiles** (ascending id): `pos += vel * dt`; `life −= dt`;
   despawn on obstacle hit (center-clamp check vs AABB), world bounds, or
   entity hit (circle-circle): apply `damage`, despawn projectile, emit `hit` event.
6. **Deaths** (ascending id): `hp ≤ 0` → dead. Bot death: `score += 100*combo`,
   `combo = min(combo+1, 5)`, `combo_timer = 3.0`, emit `kill` event.
   Player death: emit `match_end`.
7. **Nova**: triggered && `energy ≥ cost` → `energy −= cost`; every bot with
   `dist(bot, center) ≤ radius`: `hp −= 48`, `vel += normalize(bot − center) * 420`.
8. **Regen**: player `energy = min(100, energy + 14*dt)`.
9. **Survival score**: every full elapsed second, `score += 1`.
10. **Waves**: wave n spawns `3 + 2n` bots at consecutive spawn points,
    staggered 0.4s; wave n+1 spawns when all bots of wave n are dead
    (+ `wave_bonus`).
11. Update checksum.

## 7. Bot FSM (deterministic)

States: `PATROL → CHASE → STRAFE → ATTACK → FLEE`.

- **PATROL**: pick random waypoint (shared RNG) every 4s; move toward it.
- **CHASE**: `dist(player) < 520` → move toward player.
- **STRAFE**: `dist < 260` → orbit player at `0.6 × speed` (orbit sign from RNG at entry).
- **ATTACK**: LOS clear && `dist < 420` → fire at player position + jitter.
- **FLEE**: `hp < 25% max` → move away from player toward nearest obstacle corner.
- Transitions evaluated every **0.25s** per bot, staggered by `bot_id * 0.25 / n_bots`.
- LOS = segment (bot→player center) vs the 5 AABBs; clamp-based test, no trig.

## 8. Netcode (Go server ↔ clients)

- Transport: **WebSocket**, JSON frames, v1.
- Sim runs 60 Hz server-authoritative; **snapshots broadcast at 20 Hz**.
- Client input: last-wins per tick.

```
C→S  {"t":"hello","callsign":"..."}
S→C  {"t":"welcome","player_id":1,"seed":123456789,"tick_rate":60,"snapshot_hz":20,"rules_hash":"..."}
C→S  {"t":"input","seq":42,"move":[x,y],"fire":[x,y]|null,"dash":false,"nova":false}
S→C  {"t":"snapshot","tick":1234,"entities":[...],"events":[...]}
S→C  {"t":"event","kind":"kill|death|wave|nova|match_end","data":{...}}
```

- Heartbeat ping/pong every 5s; dropped clients removed after 3s.
- Room: Versus deathmatch, ≤ 8 players, ends at 5:00 or 25 kills.

## 9. Golden Vectors — `testdata/golden/ticks.json`

```json
{
  "rules_hash": "0x…",
  "generator": "core/c v1.0.0",
  "cases": [
    {
      "seed": 1337,
      "ticks": 600,
      "script": "wave-survival-default",
      "checksums": [ { "tick": 60, "checksum": "0x…" }, "…every 60 ticks…" ]
    }
  ]
}
```

- **Producer (reference)**: `core/c` (`make golden`).
- **Consumers**: Go (`services/gameserver`), Python (`services/mlops`), C#
  (`core/dotnet`) test suites — each **skips gracefully** if the file is absent,
  fails hard on mismatch when present.

## 10. Anti-cheat sanity (server-side score validation)

```
score_max = 5000 + kills*500 + wave*400 + duration_sec*2
```

Submissions exceeding `score_max` are rejected (see Java live-ops service).
