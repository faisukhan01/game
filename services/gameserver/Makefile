.PHONY: build test vet run docker clean

build:
	go build -o bin/server ./cmd/server
	go build -o bin/demo-bot ./cmd/demo-bot

vet:
	go vet ./...

test:
	go test -race ./...

run: build
	PORT=3002 ./bin/server

docker:
	docker build -t ghcr.io/faisukhan01/voidstrike-gameserver:latest .

clean:
	rm -rf bin
