#!/usr/bin/env bash
# Remove qualquer qdisc netem dos containers de servidor (R06, L04=B).
# Idempotente: nao falha se nao houver qdisc ou se o container estiver parado.
#
# Uso: bash benchmarks/netem/clear.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

COMPOSE_FILE="${COMPOSE_FILE:-${REPO_ROOT}/docker-compose.bench.yml}"
IFACE="${IFACE:-eth0}"

for svc in api nginx; do
  docker compose -f "${COMPOSE_FILE}" exec -T "${svc}" \
    sh -c "tc qdisc del dev ${IFACE} root 2>/dev/null || true" 2>/dev/null || true
done

echo "[netem] impairment removido de api e nginx (iface ${IFACE})"
