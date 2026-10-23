#!/usr/bin/env bash
# Perfis de rede degradada (R06, decisao L04=B).
#
# Mapeia o ID do perfil -> argumentos do `tc netem`. Sourced por apply.sh.
# Alinhado a literatura do TCC (polibatam2025): latencia, perda e combinacao.

# Imprime os argumentos netem para um perfil. Retorna 1 se o perfil for desconhecido.
netem_args_for() {
  case "$1" in
    clean)               printf '%s' '' ;;
    lag_100ms)           printf '%s' 'delay 100ms' ;;
    loss_1pct)           printf '%s' 'loss 1%' ;;
    lag_100ms_loss_1pct) printf '%s' 'delay 100ms loss 1%' ;;
    *) return 1 ;;
  esac
}

# Lista de perfis suportados (ordem usada pelo runner).
NETEM_PROFILES="clean lag_100ms loss_1pct lag_100ms_loss_1pct"
