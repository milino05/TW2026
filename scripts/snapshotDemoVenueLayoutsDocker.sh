#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
FIXTURE_DIR="$ROOT_DIR/scripts/fixtures/demo-venue-layouts"

mkdir -p "$FIXTURE_DIR"
cd "$ROOT_DIR"

docker compose build backend
docker compose run --rm \
  -v "$FIXTURE_DIR:/snapshot" \
  -e DEMO_LAYOUT_FIXTURE_DIR=/snapshot \
  backend npm run snapshot:demo-layouts
