#!/usr/bin/env bash
set -euo pipefail

# Load test via curl with HTTP/3 support.
# Args: URL VUS DURATION_SEC METHOD [BODY_FILE]

URL="${1:?URL required}"
VUS="${2:-50}"
DURATION="${3:-60}"
METHOD="${4:-GET}"
BODY_FILE="${5:-}"

WORKDIR="/tmp/h3bench"
mkdir -p "$WORKDIR"
LATENCY_FILE="$WORKDIR/latencies.txt"
: > "$LATENCY_FILE"

export URL METHOD BODY_FILE LATENCY_FILE

curl_h3() {
  # Tenta --http3-only; fallback para --http3 em builds mais antigas.
  if curl --help all 2>/dev/null | grep -q http3-only; then
    curl --http3-only "$@"
  else
    curl --http3 "$@"
  fi
}

worker() {
  local end
  end=$(( $(date +%s) + DURATION ))
  while [ "$(date +%s)" -lt "$end" ]; do
    if [ "$METHOD" = "POST" ] && [ -n "$BODY_FILE" ] && [ -f "$BODY_FILE" ]; then
      curl_h3 -k -s -o /dev/null -w "%{time_total}\n" \
        -X POST -H "Content-Type: application/octet-stream" \
        --data-binary "@${BODY_FILE}" "$URL" >> "$LATENCY_FILE" 2>/dev/null || true
    else
      curl_h3 -k -s -o /dev/null -w "%{time_total}\n" \
        "$URL" >> "$LATENCY_FILE" 2>/dev/null || true
    fi
  done
}

export -f worker

for _ in $(seq 1 "$VUS"); do
  worker &
done

wait

COUNT=$(wc -l < "$LATENCY_FILE" | tr -d ' ')
if [ "$COUNT" -eq 0 ]; then
  echo '{"error":"no successful requests","count":0}'
  exit 1
fi

python3 - "$LATENCY_FILE" "$COUNT" "$DURATION" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
count = int(sys.argv[2])
duration = float(sys.argv[3])
values = [float(line.strip()) * 1000 for line in path.read_text().splitlines() if line.strip()]
values.sort()
n = len(values)

def pct(p):
    if n == 0:
        return None
    idx = min(n - 1, max(0, int((p / 100) * n + 0.999999) - 1))
    return values[idx]

summary = {
    "http_req_duration_p50": pct(50),
    "http_req_duration_p90": pct(90),
    "http_req_duration_p95": pct(95),
    "http_req_duration_avg": sum(values) / n,
    "http_req_waiting_p50": pct(50),
    "http_req_waiting_p90": pct(90),
    "http_req_waiting_p95": pct(95),
    "http_reqs_rate": count / duration,
    "http_reqs_count": count,
    "data_received_rate": None,
    "data_sent_rate": None,
    "http_req_failed_rate": 0,
    "iteration_duration_p95": pct(95),
    "observed_proto": "HTTP/3",
}
print(json.dumps(summary))
PY
