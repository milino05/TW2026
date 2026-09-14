#!/bin/sh
set -eu

BACKEND_WAS_RUNNING=0

if docker compose ps --status running --services 2>/dev/null | grep -qx backend; then
  BACKEND_WAS_RUNNING=1
  docker compose stop backend
fi

restart_backend() {
  if [ "$BACKEND_WAS_RUNNING" -eq 1 ]; then
    docker compose up -d backend >/dev/null
  fi
}
trap restart_backend EXIT INT TERM

docker compose build backend
docker compose run --rm backend npm run seed:demo
