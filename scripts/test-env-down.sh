#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

if [[ "${1:-}" == "--volumes" ]]; then
  docker compose -f docker-compose.test.yml down -v
else
  docker compose -f docker-compose.test.yml down
fi
