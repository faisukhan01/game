# VOIDSTRIKE — Game Design Document (v1.0)

**Genre**: Top-down twin-stick arena shooter · **Session**: 3–8 min · **Platforms**: Browser, iOS, Android, PC, Console
**Tagline**: *Drop in. Lock on. Leave nothing.*

---

## 1. Fantasy & Pillars

You are a **Striker** — a salvage-operative dropped into collapsed orbital
arenas to hold back machine swarms (and each other) for salvage rights.

1. **60-second fun** — the first kill chain lands within 60 seconds of deploy.
2. **Readable chaos** — every death is the player's fault and the player
   understands why. Telegraphed threats, hairline-clean UI.
3. **Mastery arc** — dash routing → nova timing → combo upkeep. A day-one
   player and a month-one player play the same map differently.

## 2. Modes

| Mode | Net | Description | Ships on |
|---|---|---|---|
| **Onslaught** | Offline (bots) | Wave survival: `3+2n` bots per wave, escalating accuracy/speed/hp. Score = kills × combo + wave bonuses + survival | Web, iOS, Android, PC |
| **Versus** | Online (Go server, 60 Hz authoritative) | 8-player deathmatch. 5:00 or first to 25 kills | Web, PC, Console |
| **Ranked Ladder** | Online | Seasons (4 weeks). MMR: Glicko-lite. Tiers: Recruit → Operator → Spectre → Reaver → **Voidwalker** | All |

## 3. Core Loop

```
DEPLOY → Arena (60–180s) → Results (rank, score, best combo) → Upgrade path → RE-DEPLOY
              ↑                                            │
              └──────────── leaderboard delta ←────────────┘
```

- **Combo**: kills within 3.0s chain a ×5 max multiplier. Breaking a combo is
  the main skill expression.
- **Energy economy**: rifle shots (2) vs nova (55) forces routing decisions —
  spray and starve your nova, or pace and burst.

## 4. Striker Kit (Protocol v1)

| Ability | Numbers (see PROTOCOL.md) | Design intent |
|---|---|---|
| Pulse rifle | 10/s, 10 dmg, ±2° spread | Bread-and-butter; spread keeps range honest |
| Dash | 3.0s cd, 720 impulse | Escape + reposition; high skill ceiling |
| Void Nova | 55 energy, 210u, 48 dmg + knockback | Panic button AND combo-finisher |

## 5. Progression & Economy (roadmap)

- **Callsign identity**: permanent profile, per-mode bests, lifetime kills.
- **XP** = match score; rank thresholds per tier.
- **Credits** (season 1+): earn per match → striker skins, trail effects,
  arena broadcasting rights (cosmetic only — **no pay-for-power, ever**).

## 6. Live-Ops

- **Seasons**: 4-week ranked seasons, soft MMR reset (σ inflation), season
  banner rewards.
- **Daily quests**: e.g. "Land 3 nova multi-kills" → credit payouts.
- **Weekend modifiers**: Low Gravity Friday, Double-Combo Saturday.
- **Difficulty director** (MLOps): botlab policy models ship per-season; win-rate
  telemetry auto-tunes wave pacing (`services/mlops/telemetry`).

## 7. Telemetry Events (feed `services/mlops`)

`match_start, match_end{score,kills,wave,duration}, player_death{pos,killer_dist},
ability_used{kind,pos}, wave_cleared{n,t}, combo_broken{streak}`
Transport: JSONL batch upload → `botlab ingest` → KPI reports (DAI, retention
proxy, difficulty curve, ability usage heat).

## 8. Accessibility

- Colorblind-safe palettes (Volt/Flare tested for deuteranopia).
- Full key remapping; one-handed layout preset.
- Screen-shake reduction setting; reduced-motion honored on web.
- Touch: twin virtual sticks, 44px minimum targets.

## 9. Success Metrics (year 1 targets)

| Metric | Target |
|---|---|
| D1 / D7 / D30 retention | 45% / 18% / 8% |
| Avg session | 14 min |
| Crash-free sessions | 99.6% |
| Ranked participation | 25% of DAU |
