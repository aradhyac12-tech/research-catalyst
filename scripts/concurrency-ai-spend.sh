#!/usr/bin/env bash
# REAL concurrency check for migration 0026: many separate database sessions reserve AI budget at the same moment.
# The caps must hold exactly. Run ONLY on a DISPOSABLE database that already has migrations 0000..0026 applied.
# Usage: PSQL="psql -h /tmp -p 54329" DB=rc_replay [N=40] [EST=0.10] [PAPER_CAP=0.50] [DAY_CAP=1.00] scripts/concurrency-ai-spend.sh
set -euo pipefail
PSQL="${PSQL:-psql}"; DB="${DB:?set DB to a disposable database name}"
case "$DB" in *prod*|*live*) echo "refusing: $DB looks like production" >&2; exit 2;; esac
N="${N:-40}"; EST="${EST:-0.10}"; PAPER_CAP="${PAPER_CAP:-0.50}"; DAY_CAP="${DAY_CAP:-1.00}"
Q="$PSQL -d $DB -qAt -v ON_ERROR_STOP=1"

OWNER=$(cat /proc/sys/kernel/random/uuid)
# Two papers, so both the per-paper cap (paper A) and the daily cap (A + B together) are exercised.
PA=$($Q -c "insert into public.papers(owner_id,title) values ('$OWNER','concurrency A') returning id")
PB=$($Q -c "insert into public.papers(owner_id,title) values ('$OWNER','concurrency B') returning id")
cleanup() { $Q -c "delete from public.ai_spend where paper_id in ('$PA','$PB'); delete from public.papers where id in ('$PA','$PB');" >/dev/null 2>&1 || true; }
trap cleanup EXIT
$Q -c "delete from public.ai_spend where day = (now() at time zone 'utc')::date" >/dev/null   # disposable DB: start the day empty

OUT=$(mktemp)
for i in $(seq 1 "$N"); do
  P=$([ $((i % 2)) -eq 0 ] && echo "$PA" || echo "$PB")
  ( $Q -c "select ok from public.ai_spend_reserve('$P','gemini','m',$EST,$PAPER_CAP,$DAY_CAP)" >> "$OUT" ) &
done
wait
GRANTED=$(grep -c '^t$' "$OUT" || true); REFUSED=$(grep -c '^f$' "$OUT" || true)
TOTAL_A=$($Q -c "select coalesce(sum(cost_usd),0) from public.ai_spend where paper_id='$PA' and status<>'RELEASED'")
TOTAL_B=$($Q -c "select coalesce(sum(cost_usd),0) from public.ai_spend where paper_id='$PB' and status<>'RELEASED'")
TOTAL_DAY=$($Q -c "select coalesce(sum(cost_usd),0) from public.ai_spend where day=(now() at time zone 'utc')::date and status<>'RELEASED'")
echo "sessions=$N granted=$GRANTED refused=$REFUSED paperA=$TOTAL_A paperB=$TOTAL_B day=$TOTAL_DAY (caps: paper $PAPER_CAP, day $DAY_CAP, estimate $EST)"
python3 - "$GRANTED" "$REFUSED" "$N" "$TOTAL_A" "$TOTAL_B" "$TOTAL_DAY" "$PAPER_CAP" "$DAY_CAP" <<'PY'
import sys
g, r, n, a, b, d, pc, dc = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]), *map(float, sys.argv[4:9])
ok = (g + r == n) and a <= pc + 1e-9 and b <= pc + 1e-9 and d <= dc + 1e-9
print("PASS: caps held under concurrency" if ok else "FAIL: a cap was exceeded or a session errored")
sys.exit(0 if ok else 1)
PY
