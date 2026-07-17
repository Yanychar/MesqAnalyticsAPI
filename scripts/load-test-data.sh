#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"
docker compose -f docker-compose.test.yml exec -T mysql-test \
  mysql -uroot -proot mesq_cm_reporting_test < sql/test-fixtures/raw-stage-fixtures.sql
