.PHONY: build up down logs

build:
	go build ./... ../proto/... ../agent-linux/... ../agent-windows/...

up:
	docker compose up --build -d

down:
	docker compose down

logs:
	docker compose logs --tail=100 -f
