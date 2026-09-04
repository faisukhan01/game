.PHONY: venv train eval report test docker clean

venv:
	python3 -m venv .venv && ./.venv/bin/pip install -e ".[dev]"

train: ## short default run
	./.venv/bin/python -m botlab.cli train --timesteps 500000 --seed 1337 --out bot_policy_v1

eval:
	./.venv/bin/python -m botlab.cli eval --policy bot_policy_v1 --episodes 20

report:
	./.venv/bin/python -m botlab.cli report --out reports

test:
	./.venv/bin/python -m pytest

docker:
	docker build -t ghcr.io/faisukhan01/voidstrike-mlops:latest .

clean:
	rm -rf .venv .pytest_cache reports/*.csv
