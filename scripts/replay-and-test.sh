#!/usr/bin/env bash
# Replays drizzle/migrations on a DISPOSABLE database and runs supabase_tests/*.sql. Never point this at production.
# Usage: PSQL="psql -h /tmp -p 54329" DB=rc_replay STUBS=path/to/00_stubs.sql scripts/replay-and-test.sh
# STUBS is only needed on plain Postgres (creates anon/authenticated/service_role roles and auth/storage stubs).
set -euo pipefail
PSQL="${PSQL:-psql}"; DB="${DB:?set DB to a disposable database name}"
case "$DB" in *prod*|*live*) echo "refusing: $DB looks like production" >&2; exit 2;; esac
$PSQL -d postgres -qc "drop database if exists $DB" -c "create database $DB"
[ -n "${STUBS:-}" ] && $PSQL -d "$DB" -q -v ON_ERROR_STOP=1 -f "$STUBS"
for f in $(ls drizzle/migrations/*.sql | sort); do $PSQL -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f" && echo "migrated $f"; done
for f in $(ls supabase_tests/0*.sql | sort); do $PSQL -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 && echo "PASS $f" || { echo "FAIL $f"; exit 1; }; done
