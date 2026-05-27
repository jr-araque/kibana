#!/usr/bin/env bash
# bench-list-apis.sh
# Synthetic performance benchmark for exception list items and value list items APIs.
#
# Reproduces the O(n) HTTP round-trip cost documented in:
#   https://github.com/elastic/kibana/issues/266239
#
# What this measures:
#   1. Exception list items — single-item POST loop (exposes O(N²) SO cost from
#      validateExceptionListSize, which scans all N items after each create)
#   2. Value list items — single-item POST loop (O(N) ES cost, no size validation)
#   3. Value list items — _import NDJSON upload (O(1) ES bulk calls, the fast path)
#
# Usage:
#   # Against a dev Kibana started with `node scripts/kibana --dev`
#   ./bench-list-apis.sh
#
#   # Against the Terraform provider docker stack (make docker-fleet in terraform-provider-elasticstack)
#   KB_URL=http://localhost:5601 KB_AUTH=elastic:password ./bench-list-apis.sh
#
#   # Custom N sweep (default: 10 25 50 100 200)
#   N_VALUES="10 50 200" ./bench-list-apis.sh
#
# Prerequisites: curl, jq, python3

set -euo pipefail

# ─── Config ───────────────────────────────────────────────────────────────────
KB_URL="${KB_URL:-http://localhost:5601}"
KB_AUTH="${KB_AUTH:-elastic:changeme}"
N_VALUES="${N_VALUES:-10 25 50 100 200}"

EXC_LIST_ID="bench-exc-list-266239"
EXC_LIST_NS="single"
VAL_LIST_ID="bench-val-list-266239"

CURL="curl -s -u ${KB_AUTH} -H kbn-xsrf:true -H Content-Type:application/json"
NDJSON_TMP=$(mktemp /tmp/bench-vl-items.XXXXXX.ndjson)

# ─── Helpers ──────────────────────────────────────────────────────────────────
now_ms() { python3 -c 'import time; print(int(time.time()*1000))'; }

http_ok() {
  local url="$1" body="$2" desc="$3"
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' -u "${KB_AUTH}" \
    -H "kbn-xsrf: true" -H "Content-Type: application/json" \
    -X POST "${url}" -d "${body}")
  if [[ "$status" != 2* ]]; then
    echo "  ERROR: ${desc} → HTTP ${status}" >&2
    return 1
  fi
}

# ─── Setup ────────────────────────────────────────────────────────────────────
setup() {
  echo "=== Setup ==="

  echo -n "  Init value list data streams … "
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' -u "${KB_AUTH}" \
    -H "kbn-xsrf: true" -X POST "${KB_URL}/api/lists/index")
  echo "HTTP ${status}"

  echo -n "  Create exception list container … "
  # Delete first in case it already exists from a previous run
  curl -s -o /dev/null -u "${KB_AUTH}" -H "kbn-xsrf: true" \
    -X DELETE "${KB_URL}/api/exception_lists?list_id=${EXC_LIST_ID}&namespace_type=${EXC_LIST_NS}" || true
  status=$(curl -s -o /dev/null -w '%{http_code}' -u "${KB_AUTH}" \
    -H "kbn-xsrf: true" -H "Content-Type: application/json" \
    -X POST "${KB_URL}/api/exception_lists" \
    -d "{\"name\":\"Bench list\",\"description\":\"#266239 benchmark\",\"list_id\":\"${EXC_LIST_ID}\",\"type\":\"detection\",\"namespace_type\":\"${EXC_LIST_NS}\"}")
  echo "HTTP ${status}"

  echo -n "  Create value list container … "
  curl -s -o /dev/null -u "${KB_AUTH}" -H "kbn-xsrf: true" \
    -X DELETE "${KB_URL}/api/lists?id=${VAL_LIST_ID}" || true
  status=$(curl -s -o /dev/null -w '%{http_code}' -u "${KB_AUTH}" \
    -H "kbn-xsrf: true" -H "Content-Type: application/json" \
    -X POST "${KB_URL}/api/lists" \
    -d "{\"id\":\"${VAL_LIST_ID}\",\"name\":\"Bench value list\",\"description\":\"#266239 benchmark\",\"type\":\"keyword\"}")
  echo "HTTP ${status}"
  echo ""
}

# ─── Benchmark 1: exception list items, single-item loop ──────────────────────
bench_exc_single() {
  local n=$1
  # Fresh list for each N so validateExceptionListSize always starts from 0
  curl -s -o /dev/null -u "${KB_AUTH}" -H "kbn-xsrf: true" \
    -X DELETE "${KB_URL}/api/exception_lists?list_id=${EXC_LIST_ID}&namespace_type=${EXC_LIST_NS}" || true
  curl -s -o /dev/null -u "${KB_AUTH}" -H "kbn-xsrf: true" -H "Content-Type: application/json" \
    -X POST "${KB_URL}/api/exception_lists" \
    -d "{\"name\":\"Bench list\",\"description\":\"#266239 benchmark\",\"list_id\":\"${EXC_LIST_ID}\",\"type\":\"detection\",\"namespace_type\":\"${EXC_LIST_NS}\"}" || true

  local t0
  t0=$(now_ms)
  for i in $(seq 1 "$n"); do
    curl -s -o /dev/null -u "${KB_AUTH}" \
      -H "kbn-xsrf: true" -H "Content-Type: application/json" \
      -X POST "${KB_URL}/api/exception_lists/items" \
      -d "{\"list_id\":\"${EXC_LIST_ID}\",\"namespace_type\":\"${EXC_LIST_NS}\",\"name\":\"item-${i}\",\"description\":\"bench\",\"type\":\"simple\",\"entries\":[{\"field\":\"host.name\",\"operator\":\"included\",\"type\":\"match\",\"value\":\"host-${i}\"}]}"
  done
  local t1
  t1=$(now_ms)
  echo $(( t1 - t0 ))
}

# ─── Benchmark 2a: value list items, single-item loop (wait_for — baseline) ───
bench_val_single() {
  local n=$1
  # Recreate value list container for a clean run
  curl -s -o /dev/null -u "${KB_AUTH}" -H "kbn-xsrf: true" \
    -X DELETE "${KB_URL}/api/lists?id=${VAL_LIST_ID}" || true
  curl -s -o /dev/null -u "${KB_AUTH}" -H "kbn-xsrf: true" -H "Content-Type: application/json" \
    -X POST "${KB_URL}/api/lists" \
    -d "{\"id\":\"${VAL_LIST_ID}\",\"name\":\"Bench value list\",\"description\":\"#266239 benchmark\",\"type\":\"keyword\"}" || true

  local t0
  t0=$(now_ms)
  for i in $(seq 1 "$n"); do
    curl -s -o /dev/null -u "${KB_AUTH}" \
      -H "kbn-xsrf: true" -H "Content-Type: application/json" \
      -X POST "${KB_URL}/api/lists/items" \
      -d "{\"list_id\":\"${VAL_LIST_ID}\",\"value\":\"10.0.$((i/256)).$((i%256))\"}"
  done
  local t1
  t1=$(now_ms)
  echo $(( t1 - t0 ))
}

# ─── Benchmark 2b: value list items, single-item loop (refresh:false — POC) ──
# Requires getListItem to use esClient.get (real-time translog read).
# Without that change, the immediate read-back after each create returns 404.
bench_val_single_no_refresh() {
  local n=$1
  curl -s -o /dev/null -u "${KB_AUTH}" -H "kbn-xsrf: true" \
    -X DELETE "${KB_URL}/api/lists?id=${VAL_LIST_ID}" || true
  curl -s -o /dev/null -u "${KB_AUTH}" -H "kbn-xsrf: true" -H "Content-Type: application/json" \
    -X POST "${KB_URL}/api/lists" \
    -d "{\"id\":\"${VAL_LIST_ID}\",\"name\":\"Bench value list\",\"description\":\"#266239 benchmark\",\"type\":\"keyword\"}" || true

  local t0
  t0=$(now_ms)
  for i in $(seq 1 "$n"); do
    curl -s -o /dev/null -u "${KB_AUTH}" \
      -H "kbn-xsrf: true" -H "Content-Type: application/json" \
      -X POST "${KB_URL}/api/lists/items" \
      -d "{\"list_id\":\"${VAL_LIST_ID}\",\"value\":\"10.0.$((i/256)).$((i%256))\",\"refresh\":\"false\"}"
  done
  local t1
  t1=$(now_ms)
  echo $(( t1 - t0 ))
}

# ─── Benchmark 3: value list items, _import NDJSON ────────────────────────────
bench_val_import() {
  local n=$1
  # Recreate value list container
  curl -s -o /dev/null -u "${KB_AUTH}" -H "kbn-xsrf: true" \
    -X DELETE "${KB_URL}/api/lists?id=${VAL_LIST_ID}" || true
  curl -s -o /dev/null -u "${KB_AUTH}" -H "kbn-xsrf: true" -H "Content-Type: application/json" \
    -X POST "${KB_URL}/api/lists" \
    -d "{\"id\":\"${VAL_LIST_ID}\",\"name\":\"Bench value list\",\"description\":\"#266239 benchmark\",\"type\":\"keyword\"}" || true

  # Generate NDJSON payload (one value per line)
  python3 -c "
import json
for i in range(${n}):
    print(json.dumps({'list_id':'${VAL_LIST_ID}','value':f'192.168.{i//256}.{i%256}'}))
" > "${NDJSON_TMP}"

  local t0
  t0=$(now_ms)
  curl -s -o /dev/null -u "${KB_AUTH}" \
    -H "kbn-xsrf: true" \
    -X POST "${KB_URL}/api/lists/items/_import?type=keyword" \
    -F "file=@${NDJSON_TMP};type=application/octet-stream"
  local t1
  t1=$(now_ms)
  echo $(( t1 - t0 ))
}

# ─── Cleanup ──────────────────────────────────────────────────────────────────
cleanup() {
  echo ""
  echo "=== Cleanup ==="
  curl -s -o /dev/null -u "${KB_AUTH}" -H "kbn-xsrf: true" \
    -X DELETE "${KB_URL}/api/exception_lists?list_id=${EXC_LIST_ID}&namespace_type=${EXC_LIST_NS}" && echo "  Deleted exception list"
  curl -s -o /dev/null -u "${KB_AUTH}" -H "kbn-xsrf: true" \
    -X DELETE "${KB_URL}/api/lists?id=${VAL_LIST_ID}" && echo "  Deleted value list"
  rm -f "${NDJSON_TMP}"
}

trap cleanup EXIT

# ─── Main ─────────────────────────────────────────────────────────────────────
echo "=== Kibana Lists API — Performance Benchmark ==="
echo "    Target: ${KB_URL}"
echo "    N sweep: ${N_VALUES}"
echo ""

setup

# Header
printf "\n%-6s  %-18s %-12s | %-18s %-12s | %-22s %-12s | %-18s %-12s\n" \
  "N" \
  "exc-single(ms)" "exc ms/item" \
  "val-wait_for(ms)" "val ms/item" \
  "val-no_refresh(ms)" "val ms/item" \
  "val-import(ms)" "import ms/item"
printf "%s\n" "-------  ------------------  ------------ | ------------------  ------------ | ----------------------  ------------ | ------------------  ------------"

first_exc_ms=""
last_exc_ms=""
last_val_ms=""
last_val_nr_ms=""
last_imp_ms=""

for n in $N_VALUES; do
  echo -n "  N=${n}: exc-single … " >&2
  exc_ms=$(bench_exc_single "$n")
  echo -n "val-wait_for … " >&2
  val_ms=$(bench_val_single "$n")
  echo -n "val-no_refresh … " >&2
  val_nr_ms=$(bench_val_single_no_refresh "$n")
  echo -n "val-import … " >&2
  imp_ms=$(bench_val_import "$n")
  echo "done" >&2

  exc_per_item=$(python3 -c "print(f'{${exc_ms}/${n}:.1f}')")
  val_per_item=$(python3 -c "print(f'{${val_ms}/${n}:.1f}')")
  val_nr_per_item=$(python3 -c "print(f'{${val_nr_ms}/${n}:.1f}')")
  imp_per_item=$(python3 -c "print(f'{${imp_ms}/${n}:.1f}')")

  [[ -z "$first_exc_ms" ]] && first_exc_ms=$exc_ms
  last_exc_ms=$exc_ms
  last_val_ms=$val_ms
  last_val_nr_ms=$val_nr_ms
  last_imp_ms=$imp_ms

  printf "%-6s  %-18s %-12s | %-18s %-12s | %-22s %-12s | %-18s %-12s\n" \
    "$n" \
    "${exc_ms}" "${exc_per_item}" \
    "${val_ms}" "${val_per_item}" \
    "${val_nr_ms}" "${val_nr_per_item}" \
    "${imp_ms}" "${imp_per_item}"
done

# Analysis: dominant bottleneck is refresh:wait_for (~1s/item), not O(N²) SO cost
n_arr=($N_VALUES)
n_min="${n_arr[0]}"
n_max="${n_arr[$((${#n_arr[@]}-1))]}"
if (( ${#n_arr[@]} >= 2 )); then
  exc_ms_min=$first_exc_ms
  exc_ms_max=$last_exc_ms
  val_ms_max=$last_val_ms
  val_nr_ms_max=$last_val_nr_ms
  imp_ms_max=$last_imp_ms

  exc_ratio=$(python3 -c "print(f'{${exc_ms_max}/${exc_ms_min}:.2f}')" 2>/dev/null || echo "n/a")
  linear_ratio=$(python3 -c "print(f'{$n_max/$n_min:.2f}')")
  nr_speedup=$(python3 -c "print(f'{${val_ms_max}/${val_nr_ms_max}:.1f}')" 2>/dev/null || echo "n/a")
  slowdown=$(python3 -c "print(f'{${val_ms_max}/${imp_ms_max}:.1f}')" 2>/dev/null || echo "n/a")

  echo ""
  echo "=== Analysis ==="
  echo "  Exception items N=${n_min}→${n_max}: time ratio = ${exc_ratio}x (linear would be ${linear_ratio}x)"
  echo "  → Wall time is linear: dominated by refresh:wait_for (~1s/item), not O(N²) SO cost"
  echo ""
  echo "  val-no_refresh vs val-wait_for at N=${n_max}: ${nr_speedup}x faster"
  echo "  → POC: getListItem using esClient.get allows refresh:false on single-item creates"
  echo ""
  echo "  val-wait_for vs _import at N=${n_max}: single is ${slowdown}x slower"
  echo "  → _import amortizes refresh across the batch; the bulk endpoint target"
  echo ""

  # Extrapolate customer scenario: 12,000 value list items
  echo "=== Customer extrapolation (12,000 value list items) ==="
  python3 -c "
val_ms_per    = ${val_ms_max} / $n_max
val_nr_ms_per = ${val_nr_ms_max} / $n_max
imp_ms_per    = ${imp_ms_max} / $n_max
val_12k    = val_ms_per    * 12000 / 1000 / 60
val_nr_12k = val_nr_ms_per * 12000 / 1000 / 60
imp_12k    = imp_ms_per    * 12000 / 1000 / 60
print(f'  wait_for creates   @ {val_ms_per:.1f} ms/item -> {val_12k:.1f} min for 12,000 items')
print(f'  no_refresh creates @ {val_nr_ms_per:.1f} ms/item -> {val_nr_12k:.1f} min for 12,000 items')
print(f'  _import batches    @ {imp_ms_per:.1f} ms/item -> {imp_12k:.1f} min for 12,000 items')
"
fi

echo ""
echo "Done. Fill in the 'What to record' table in the issue tracker."
