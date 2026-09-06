# VOIDSTRIKE — Deployment

## Environments

| Env | Web | Gameserver | Live-ops | MLOps |
|---|---|---|---|---|
| dev | `bun run dev` (:3000) | `make run-server` (:3002) | `mvn spring-boot:run` (:8080) | venv + pytest |
| prod | Docker (`infra/Dockerfile.web`) behind edge | GHCR image + K8s HPA (3→20) | GHCR image | CI/cron batch |

## Docker (full stack locally)

```bash
docker compose -f infra/docker-compose.yml up --build -d
# web :3000 · gameserver :3002 · live-ops :8080 · prometheus :9090 · grafana :3001
```

## Kubernetes

```bash
kubectl apply -f infra/k8s/base/gameserver.yaml
```

- 3–20 replicas on CPU 65%; readiness on `/readyz`, liveness on `/healthz`.
- Room state is in-process → scale per-region; use a WS-affinity ingress and
  pin clients to a region endpoint.

## CI/CD

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | push/PR | 9 jobs: C core (+golden artifact), C# core, web lint+build, Go vet+race, pytest, Java tests, Android assemble, Flutter analyze+test, gitleaks |
| `release.yml` | tag `v*` | GHCR images (gameserver/mlops/leaderboard) + web build + release notes |
| `unity-build.yml` | manual | GameCI editor build (needs Unity secrets) |
| `unreal-build.yml` | manual | UBT build (needs Epic runner creds) |

## Observability

- Prometheus scrapes gameserver + live-ops (`infra/monitoring/prometheus.yml`).
- Grafana datasource pre-provisioned; key panels: rooms active, players
  connected, tick duration p99, WS error rate, submission verdict mix.

## Runbook quick links

- Gameserver unhealthy → check `/readyz` capacity, `kubectl logs`, room
  janitor logs; scale `MAX_ROOMS`.
- Ladder fraud spike → inspect Java verdict metrics; tighten ceiling in
  `ScoreSanityValidator` (Protocol §10).
- Bot win-rate drift → `botlab eval` current registry; roll back manifest.
