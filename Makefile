.PHONY: core golden test-web test-server test-mlops test-java build-server \
        run-server run-web test-all docker-up docker-down lint fmt clean

# ---- core ----
core:
	make -C core/c all test

golden:
	make -C core/c golden

# ---- services ----
test-web:
	bun run lint

build-server:
	cd services/gameserver && go build ./...

test-server:
	cd services/gameserver && go vet ./... && go test -race ./...

test-mlops:
	cd services/mlops && ./.venv/bin/python -m pytest

train-bot:
	cd services/mlops && ./.venv/bin/python -m botlab.cli train --timesteps 500000 --seed 1337 --out bot_policy_v1

test-java:
	cd services/leaderboard && mvn -q -B test

# ---- orchestration ----
run-server:
	cd services/gameserver && PORT=3002 go run ./cmd/server

run-web:
	bun run dev

test-all: core test-server test-mlops test-java

docker-up:
	docker compose -f infra/docker-compose.yml up --build -d

docker-down:
	docker compose -f infra/docker-compose.yml down

clean:
	rm -rf core/c/build services/gameserver/bin
