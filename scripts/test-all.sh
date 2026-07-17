#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="${BASE_URL:-http://localhost:3021}"
MYSQL_COMPOSE_ARGS=(-f docker-compose.test.yml)
MYSQL_CMD=(docker compose "${MYSQL_COMPOSE_ARGS[@]}" exec -T mysql-test mysql -N -B -uroot -proot mesq_cm_reporting_test)

fail() {
  echo "[FAIL] $1" >&2
  exit 1
}

pass() {
  echo "[PASS] $1"
}

http_json() {
  local method="$1"
  local url="$2"
  local body="${3:-}"

  if [[ -n "$body" ]]; then
    curl -fsS -X "$method" "$url" -H 'Content-Type: application/json' -d "$body"
  else
    curl -fsS -X "$method" "$url"
  fi
}

http_status() {
  local url="$1"
  curl -s -o /dev/null -w '%{http_code}' "$url"
}

json_field() {
  local field="$1"
  local payload="$2"
  JSON_PAYLOAD="$payload" python3 - "$field" <<'PY'
import json
import os
import sys

field = sys.argv[1]
payload = json.loads(os.environ['JSON_PAYLOAD'])
value = payload
for part in field.split('.'):
    if part.isdigit():
        value = value[int(part)]
    else:
        value = value[part]
if isinstance(value, (dict, list)):
    print(json.dumps(value))
elif isinstance(value, bool):
    print(str(value).lower())
elif value is None:
    print("null")
else:
    print(value)
PY
}

assert_equals() {
  local expected="$1"
  local actual="$2"
  local label="$3"

  if [[ "$expected" != "$actual" ]]; then
    fail "$label: expected '$expected' but got '$actual'"
  fi

  pass "$label"
}

run_sql_value() {
  local sql="$1"
  (cd "$ROOT_DIR" && "${MYSQL_CMD[@]}" -e "$sql") | tr -d '\r'
}

assert_sql_value() {
  local expected="$1"
  local sql="$2"
  local label="$3"
  local actual
  actual="$(run_sql_value "$sql")"
  assert_equals "$expected" "$actual" "$label"
}

run_sql_check_file() {
  local file="$1"
  local label="$2"
  local output
  output="$(cd "$ROOT_DIR" && "${MYSQL_CMD[@]}" < "$file")"

  while IFS=$'\t' read -r check_name expected actual; do
    [[ -z "${check_name:-}" ]] && continue
    assert_equals "$expected" "$actual" "$label / $check_name"
  done <<< "$output"
}

wait_for_app() {
  local attempts=90

  for ((i=1; i<=attempts; i++)); do
    if [[ "$(http_status "$BASE_URL/health/mysql")" == "200" ]]; then
      pass "test app health endpoint is reachable"
      return 0
    fi
    sleep 2
  done

  fail "test app did not become healthy at $BASE_URL/health/mysql"
}

cd "$ROOT_DIR"

echo "[INFO] Starting isolated MESQ test environment"
./scripts/test-env-up.sh
wait_for_app

echo "[INFO] Resetting test database"
./scripts/reset-test-db.sh

echo "[INFO] Loading raw staging fixtures"
./scripts/load-test-data.sh

assert_sql_value "2" "SELECT COUNT(*) FROM ClinicmindsRawRecord;" "raw fixture row count"
assert_sql_value "0" "SELECT COUNT(*) FROM CmPatient;" "no staged patients before test"
assert_sql_value "0" "SELECT COUNT(*) FROM CmTreatment;" "no staged treatments before test"

echo "[INFO] Running patient stage conversion"
patient_stage_response="$(http_json POST "$BASE_URL/clinicminds/stage/cmPatient" '{}')"
assert_equals "SUCCEEDED" "$(json_field status "$patient_stage_response")" "patient stage run status"
assert_equals "1" "$(json_field staged "$patient_stage_response")" "patient stage staged count"

echo "[INFO] Running material treatment stage conversion"
treatment_stage_response="$(http_json POST "$BASE_URL/clinicminds/stage/cmMaterialTreatment" '{}')"
assert_equals "SUCCEEDED" "$(json_field status "$treatment_stage_response")" "material treatment stage run status"
assert_equals "1" "$(json_field staged "$treatment_stage_response")" "material treatment stage staged count"

echo "[INFO] Loading staged report fixtures"
docker compose "${MYSQL_COMPOSE_ARGS[@]}" exec -T mysql-test \
  mysql -uroot -proot mesq_cm_reporting_test < sql/test-fixtures/report-fixtures.sql

run_sql_check_file "sql/checks/stage-consistency.sql" "stage consistency"
run_sql_check_file "sql/checks/report-consistency.sql" "report consistency"

echo "[INFO] Checking smoke endpoints"
assert_equals "200" "$(http_status "$BASE_URL/help")" "GET /help"
assert_equals "200" "$(http_status "$BASE_URL/clinicminds/stage/entities")" "GET /clinicminds/stage/entities"
assert_equals "200" "$(http_status "$BASE_URL/clinicminds/stage/patients?limit=5")" "GET /clinicminds/stage/patients"
assert_equals "200" "$(http_status "$BASE_URL/clinicminds/stage/treatments?limit=5")" "GET /clinicminds/stage/treatments"
assert_equals "200" "$(http_status "$BASE_URL/reports")" "GET /reports"

echo "[INFO] Checking invoice amounts report preview"
report_response="$(http_json POST "$BASE_URL/reports/invoice-amounts/run" '{"invoiceDateFrom":"2026-07-01","invoiceDateTo":"2026-07-31"}')"
assert_equals "1" "$(json_field summary.0.value "$report_response")" "report invoice count"
assert_equals "100" "$(json_field summary.1.value "$report_response")" "report total VAT excl"
assert_equals "20" "$(json_field summary.2.value "$report_response")" "report materials VAT excl"
assert_equals "80" "$(json_field summary.3.value "$report_response")" "report remaining VAT excl"
assert_equals "24" "$(json_field summary.4.value "$report_response")" "report VAT"
assert_equals "100" "$(json_field summary.5.value "$report_response")" "report paid"
assert_equals "0" "$(json_field errors "$report_response" | python3 -c 'import sys, json; print(len(json.load(sys.stdin)))')" "report error count"

echo "[INFO] Checking report downloads"
csv_headers="$(curl -fsS -D - -o /tmp/mesq-test-report.csv "$BASE_URL/reports/invoice-amounts/download?format=csv&invoiceDateFrom=2026-07-01&invoiceDateTo=2026-07-31")"
xlsx_headers="$(curl -fsS -D - -o /tmp/mesq-test-report.xlsx "$BASE_URL/reports/invoice-amounts/download?format=xlsx&invoiceDateFrom=2026-07-01&invoiceDateTo=2026-07-31")"
printf '%s' "$csv_headers" | grep -q 'Content-Disposition: attachment; filename="Invoice_amounts_report-' || fail "CSV export filename header is missing report name"
printf '%s' "$xlsx_headers" | grep -q 'Content-Disposition: attachment; filename="Invoice_amounts_report-' || fail "XLSX export filename header is missing report name"
[[ -s /tmp/mesq-test-report.csv ]] || fail "CSV export file is empty"
[[ -s /tmp/mesq-test-report.xlsx ]] || fail "XLSX export file is empty"
pass "report download headers and files"

echo
echo "MESQ isolated test environment checks completed successfully."
echo "Test app stays running at $BASE_URL for inspection."
echo "Use ./scripts/test-env-down.sh --volumes to remove the test containers and test MySQL volume."
