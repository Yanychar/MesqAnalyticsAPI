# MESQ Testing

This project now includes an isolated Docker-based test environment that does not use the main MESQ MySQL container.

## Test environment

- App test URL: `http://localhost:3021`
- MySQL test port: `3327`
- Test database: `mesq_cm_reporting_test`
- Compose file: `docker-compose.test.yml`
- Env file: `.env.test`

The test environment is designed for repeatable fixture-based checks:

- raw fixture rows are inserted directly into `ClinicmindsRawRecord`
- stage conversion is executed through real HTTP endpoints
- report checks run against staged fixture data

`APP_ENABLE_RAW_SYNC=false` in `.env.test` on purpose.
This keeps test cron jobs and live Clinicminds reads disabled, while still allowing stage and report testing.

## One-command test run

Run in WSL:

```bash
cd /home/sevastia/MesqAnalyticsAPI
./scripts/test-all.sh
```

What it does:

1. starts `app-test` and `mysql-test`
2. waits for `GET /health/mysql`
3. resets the test schema data
4. loads raw staging fixtures
5. runs stage conversion for `cmPatient`
6. runs stage conversion for `cmMaterialTreatment`
7. loads staged invoice fixture data
8. runs SQL consistency checks
9. runs report preview checks
10. checks CSV and XLSX downloads

## Test environment lifecycle

Start or rebuild:

```bash
./scripts/test-env-up.sh
```

Stop test containers:

```bash
./scripts/test-env-down.sh
```

Stop test containers and remove the test MySQL volume:

```bash
./scripts/test-env-down.sh --volumes
```

Reset only the test database contents:

```bash
./scripts/reset-test-db.sh
```

Load only the raw test fixtures:

```bash
./scripts/load-test-data.sh
```

## Fixture and check files

- `sql/reset-test-db.sql`
- `sql/test-fixtures/raw-stage-fixtures.sql`
- `sql/test-fixtures/report-fixtures.sql`
- `sql/checks/stage-consistency.sql`
- `sql/checks/report-consistency.sql`
- `requests/smoke.http`

## Current automatic coverage

- app and MySQL health
- stage entity discovery
- patient stage conversion
- material-treatment stage conversion
- stage consistency SQL checks
- invoice amounts report preview totals
- CSV export
- XLSX export
- export filename uses report name

## Current limits

- live Clinicminds raw sync is not exercised in the isolated test environment
- invoice stage conversion is not yet covered by test fixtures
- cron timing itself is not simulated by the script

Those can be added later with dedicated raw invoice fixtures and cron status endpoints.
