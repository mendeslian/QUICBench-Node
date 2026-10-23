#!/usr/bin/env bash
# Aplica um perfil de rede degradada (R06, L04=B) nos containers de servidor.
#
# Estrategia: `tc netem` no egress de cada container de servidor (api e nginx),
# porem SO no trafego voltado ao cliente. O hop interno NGINX<->API e isento,
# via filtro u32 que envia o trafego destinado ao IP do peer para uma banda
# limpa (1:1), enquanto todo o resto cai na banda com netem (1:3).
#
# Assim H/1.1, H/2 e H/3 recebem a mesma degradacao na perna cliente<->servidor,
# sem penalizar em dobro o caminho do proxy.
#
# Uso: bash benchmarks/netem/apply.sh <clean|lag_100ms|loss_1pct|lag_100ms_loss_1pct>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck source=benchmarks/netem/profiles.sh
. "${SCRIPT_DIR}/profiles.sh"

PROFILE="${1:?uso: apply.sh <perfil> (${NETEM_PROFILES})}"

COMPOSE_FILE="${COMPOSE_FILE:-${REPO_ROOT}/docker-compose.bench.yml}"
IFACE="${IFACE:-eth0}"
# Devem casar com docker-compose.bench.yml.
API_IP="${API_IP:-172.30.0.10}"
NGINX_IP="${NGINX_IP:-172.30.0.20}"

if ! NETEM_ARGS="$(netem_args_for "${PROFILE}")"; then
  echo "[netem] perfil desconhecido: ${PROFILE}" >&2
  echo "[netem] perfis validos: ${NETEM_PROFILES}" >&2
  exit 1
fi

# Aplica (ou limpa, se netem vazio) em um servico, isentando o IP do peer interno.
apply_to() {
  local svc="$1" peer_ip="$2"
  docker compose -f "${COMPOSE_FILE}" exec -T "${svc}" sh -s <<EOF
set -e
tc qdisc del dev ${IFACE} root 2>/dev/null || true
if [ -n "${NETEM_ARGS}" ]; then
  # prio com priomap todo "2": trafego nao classificado -> banda 1:3 (netem).
  tc qdisc add dev ${IFACE} root handle 1: prio bands 3 priomap 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2
  tc qdisc add dev ${IFACE} parent 1:3 handle 30: netem ${NETEM_ARGS}
  # Trafego para o peer interno -> banda limpa 1:1 (sem netem).
  tc filter add dev ${IFACE} parent 1: protocol ip prio 1 u32 match ip dst ${peer_ip}/32 flowid 1:1
fi
EOF
}

echo "[netem] aplicando perfil '${PROFILE}' (netem: '${NETEM_ARGS:-nenhum}')"
apply_to api "${NGINX_IP}"
apply_to nginx "${API_IP}"
echo "[netem] perfil '${PROFILE}' aplicado em api e nginx (iface ${IFACE})"
