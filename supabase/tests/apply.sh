#!/usr/bin/env bash
# Apply every migration, in order, to a fresh database on a plain Postgres,
# over the Supabase stand-in, then run the checks. Fails on the first error.
#   PGHOST, PGPORT, PGUSER as usual; DB defaults to sm_migrations.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
db="${DB:-sm_migrations}"
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $db" -c "create database $db"
run() { psql -v ON_ERROR_STOP=1 -q -X -d "$db" -f "$1"; }
run "$here/supabase-shim.sql"
for f in $(ls "$here/../migrations/"*.sql | sort); do
  echo "apply $(basename "$f")"
  # Each migration in its own transaction, as the Supabase CLI applies them.
  psql -v ON_ERROR_STOP=1 -q -X -d "$db" --single-transaction -f "$f"
done
# Applying them all a second time proves they're safe to run again.
if [ "${TWICE:-1}" = "1" ]; then
  for f in $(ls "$here/../migrations/"*.sql | sort); do
    case "$(basename "$f")" in 0001_*|0002_*) continue ;; esac  # 0001 and 0002 predate the idempotency rule
    psql -v ON_ERROR_STOP=1 -q -X -d "$db" --single-transaction -f "$f"
  done
fi
echo "checks"
# checks.sql feeds commit_table the payload the app builds (commit-table-payload.json, written by
# apps/web/lib/live/commit-payload.test.ts), passed as a psql variable.
psql -v ON_ERROR_STOP=1 -q -X -d "$db" -v payload="$(cat "$here/commit-table-payload.json")" -f "$here/checks.sql"
echo "ok"
