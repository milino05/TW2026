#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
FIXTURE_DIR="$ROOT_DIR/scripts/fixtures/demo-database"
BACKEND_WAS_RUNNING=0

mkdir -p "$FIXTURE_DIR"

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
docker compose run --rm \
  --user "$(id -u):$(id -g)" \
  -v "$FIXTURE_DIR:/snapshot" \
  -e DEMO_DATABASE_FIXTURE_DIR=/snapshot \
  backend node -r ./config/mongoUnitOfWork.js scripts/snapshotDemoDatabase.js
