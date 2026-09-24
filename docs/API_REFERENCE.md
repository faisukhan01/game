# VOIDSTRIKE — API Reference

## Web client APIs (Next.js route handlers)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/player` | `{callsign}` | Player DTO |
| POST | `/api/matches` | `{callsign, score, kills, wave, durationSec}` | `{player, rank, top[]}` — 422 on sanity failure |
| GET | `/api/leaderboard?limit=10` | — | `[{rank, callsign, bestScore, bestWave, matches}]` |
| GET | `/api/stats` | — | `{players, matches, topScore, seasonEndsAt}` |
| GET | `/api/health` | — | `{ok, service, protocol}` |

Validation: callsign `^[A-Z0-9_-]{3,16}$`; score ceiling per PROTOCOL §10.

## Gameserver (Go)

| Route | Purpose |
|---|---|
| `GET /ws` | WebSocket, PROTOCOL §8 frames |
| `GET /healthz` | liveness |
| `GET /readyz` | readiness (capacity) |
| `GET /metrics` | Prometheus: `voidstrike_rooms_active`, `voidstrike_players_connected`, `voidstrike_ticks_total`, … |

### WS frames

```
C→S  {"t":"hello","callsign":"..."}
S→C  {"t":"welcome","player_id":1,"seed":...,"tick_rate":60,"snapshot_hz":20,"rules_hash":"0x…"}
C→S  {"t":"input","seq":42,"move":[x,y],"fire":[x,y]|null,"dash":false,"nova":false}
S→C  {"t":"snapshot","tick":n,"score":n,"wave":n,"e":[{id,k,x,y,hp,a}],"p":[[x,y,team]],"ev":[...]}
S→C  {"t":"event","kind":"kill|death|wave|nova|match_end","data":{...}}
```

## Live-ops (Java, `:8080`)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/matches` | validated submission → `ACCEPT` / `FLAG` / 422 `REJECT` |
| GET | `/api/v1/leaderboard` | top 20 by best score |
| GET | `/api/v1/players/{callsign}` | aggregate profile |
| GET | `/actuator/prometheus` | metrics |

## MLOps CLI

```bash
botlab train --timesteps N --seed S --out NAME --algo auto|dqn|tabular
botlab eval  --policy NAME --episodes N     # promotion gate vs baseline
botlab ingest path.jsonl                    # telemetry KPIs
botlab report --out reports/
botlab list                                 # registry manifest table
```
