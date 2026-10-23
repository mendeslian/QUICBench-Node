# Benchmarks — comparação HTTP/1.1 / HTTP/2 / HTTP/3

Roteiro reproduzível para o estudo de caso do TCC (Cap. 4–5). Os scripts medem as rotas `/bench/ping`, `/bench/payload/:size` e `POST /bench/echo` com o mesmo contrato REST nos três caminhos de protocolo.

## Decisões experimentais

| Lacuna | Decisão |
|--------|---------|
| **L01** | 10 / 50 / 100 VUs, 60s por execução, ramp-up 10s |
| **L03** | H/1.1 em `http://localhost:3000`; H/2 e H/3 em `https://localhost:8443` |
| **L04** | Rede degradada via `tc netem` em Docker (ver seção "Rede degradada (R06)") |
| **L05** | 30 réplicas por célula (modo `full`); mediana + IQR via `bench:agg` |

## Arquitetura dos caminhos

```text
HTTP/1.1  →  http://localhost:3000/bench/*     (k6, direto na API)
HTTP/2    →  https://localhost:8443/bench/*     (k6, ALPN h2 no NGINX)
HTTP/3    →  https://localhost:8443/bench/*     (curl HTTP/3 em Docker → NGINX QUIC)
```

> **Limitação:** O k6 não suporta HTTP/3. O caminho H/3 usa cliente QUIC em Docker (`benchmarks/http3/`), com métricas normalizadas para o mesmo schema JSON dos summaries k6.

## Pré-requisitos

- Node.js ≥ 18, Docker, [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/)
- API com `BENCHMARK_MODE=true` (desabilita rate limiter)
- Proxy NGINX para H/2 e H/3: `npm run dev:nginx`

### Variáveis de ambiente (`.env`)

```env
BENCHMARK_MODE=true
# Opcional: export NDJSON da API durante os testes
# METRICS_FILE=benchmarks/results/metrics.ndjson
```

## Validação manual dos três protocolos

Com API + proxy rodando:

```bash
# HTTP/1.1 (baseline direto)
curl -s http://localhost:3000/bench/ping

# HTTP/2 (via NGINX, ALPN)
curl -k -s --http2 https://localhost:8443/bench/ping

# HTTP/3 (via NGINX QUIC) — requer curl com suporte HTTP/3
docker run --rm --add-host=host.docker.internal:host-gateway alpine/curl-http3 \
  curl -k -s --http3-only https://host.docker.internal:8443/bench/ping
```

Confirme `res.proto` no k6: `HTTP/1.1` para H/1.1 e `HTTP/2.0` para H/2.

## Estrutura

```text
benchmarks/
  k6/
    lib/config.js    # BASE_URL por PROTO, thresholds, handleSummary
    ping.js          # GET /bench/ping
    payload.js       # GET /bench/payload/:size
    echo.js          # POST /bench/echo
  http3/
    run-h3.ps1       # cliente QUIC (Docker)
    run-load.sh      # carga concorrente com curl --http3-only
    Dockerfile
  scripts/
    campaign.ps1     # pasta datada da campanha + pausa entre réplicas
    run-all.ps1      # orquestra matriz completa
    run-degraded.ps1 # matriz sob rede degradada (netem)
    validate-campaign.ps1   # valida a completude de uma campanha
    wait-and-agg.ps1        # aguarda a campanha terminar, agrega e valida
    run-tcc-followup.ps1    # aguarda a campanha, agrega e escreve o resumo
    tcc-pipeline-monitor.ps1 # igual ao anterior, com log e timeout
    aggregate.ts     # mediana + IQR → summary.json/csv
  results/           # versionadas só as duas campanhas do TCC (2026-10-01_08-38-06 e 2026-10-15_10-13-06) — subpastas yyyy-MM-dd_HH-mm-ss por campanha
```

## Matriz experimental (default)

| Endpoint | Cargas (VUs) | Protocolos |
|----------|--------------|------------|
| `/bench/ping` | 10, 50, 100 | h1, h2, h3 |
| `/bench/payload/1kb` | 50 | h1, h2, h3 |
| `/bench/payload/100kb` | 50 | h1, h2, h3 |
| `/bench/payload/1mb` | 50 | h1, h2, h3 |
| `POST /bench/echo` (100 KB) | 50 | h1, h2, h3 |

Cada célula gera `REPS` arquivos JSON na pasta da campanha (`benchmarks/results/yyyy-MM-dd_HH-mm-ss/`). Novas execuções criam outra subpasta; não é necessário limpar `results/` antes de rodar de novo.

## Execução

### 1. Subir ambiente

```bash
# Terminal 1 — API + NGINX
# Defina BENCHMARK_MODE=true no .env antes de subir
npm run dev:nginx
```

### 2. Rodar benchmarks

```bash
# Validação rápida (3 réplicas, ~30–60 min dependendo da máquina)
npm run bench:run

# Matriz completa para Cap. 5 (30 réplicas, várias horas)
npm run bench:run -- -RepsMode full

# Apenas um protocolo
npm run bench:run -- -Proto h1
npm run bench:run -- -Proto h3

# Réplicas em sequência, sem pausa (comportamento antigo)
npm run bench:run -- -NoPause
```

**Pausa entre réplicas:** por padrão, **600 s (10 min)** de resfriamento após cada réplica (`-CooldownSec`). Com `-Reps 1` não há pausa. Use `-NoPause` para execução contínua ou `-CooldownSec 0` para pausa manual (Enter).

Parâmetros do runner (`benchmarks/scripts/run-all.ps1`; `run-degraded.ps1` aceita os mesmos `-NoPause`, `-Reps` e `-CooldownSec`):

| Parâmetro | Valores | Padrão |
|-----------|---------|--------|
| `-RepsMode` | `quick` (3), `full` (30) | `quick` |
| `-Reps` | inteiro; se > 0, substitui `-RepsMode` | `0` |
| `-Proto` | `all`, `h1`, `h2`, `h3` | `all` |
| `-Duration` | segundos | `60` |
| `-Ramp` | segundos | `10` |
| `-CooldownSec` | segundos entre réplicas | `600` |
| `-NoPause` | switch | desliga pausa |

Ao iniciar, o runner imprime o caminho da campanha; ao terminar, sugere o comando de agregação com esse caminho.

### 3. Agregar resultados (mediana + IQR)

```bash
# Campanha mais recente (subpasta datada em benchmarks/results/)
npm run bench:agg

# Campanha específica
npm run bench:agg -- benchmarks/results/2026-09-24_14-39-05

# JSON soltos na raiz (layout legado)
npm run bench:agg -- benchmarks/results
```

Saídas (dentro da pasta da campanha agregada):

- `summary.json`
- `summary.csv`

### 4. Execução individual (k6)

```bash
k6 run --env PROTO=h1 --env ENDPOINT=ping --env LOAD=50 --env REP=1 \
  --env OUT=benchmarks/results/h1_ping_50_r01.json \
  benchmarks/k6/ping.js

k6 run --env PROTO=h2 --env ENDPOINT=payload_1mb --env SIZE=1mb --env LOAD=50 \
  --env OUT=benchmarks/results/h2_payload_1mb_50_r01.json \
  benchmarks/k6/payload.js
```

### 5. Execução individual (HTTP/3)

```powershell
pwsh benchmarks/http3/run-h3.ps1 -Endpoint ping -Load 50 -Rep 1
pwsh benchmarks/http3/run-h3.ps1 -Endpoint payload -Size 100kb -Load 50 -Rep 1
pwsh benchmarks/http3/run-h3.ps1 -Endpoint echo -Load 50 -BodyBytes 102400 -Rep 1
```

## Schema do summary JSON

```json
{
  "tags": {
    "proto": "h1",
    "endpoint": "ping",
    "load": 50,
    "rep": 1,
    "seed": "a1b2c3d4",
    "network_profile": "clean",
    "timestamp": "2026-09-06T20:00:00.000Z",
    "tool": "k6"
  },
  "metrics": {
    "http_req_duration_p50": 1.2,
    "http_req_duration_p95": 3.4,
    "http_req_waiting_p50": 1.0,
    "http_reqs_rate": 1200.5,
    "observed_proto": "HTTP/1.1"
  }
}
```

Métricas alinhadas ao §2.8 do TCC: latência, tempo de resposta (`http_req_duration`), TTFB (`http_req_waiting`), throughput (`data_*_rate`) e req/s (`http_reqs_rate`).

A tag `network_profile` identifica o perfil de rede da execução (`clean` por padrão; ver seção abaixo). O agregador agrupa por `(proto, endpoint, load, network_profile)`.

## Rede degradada (R06)

Cenário de rede degradada do TCC (§2.8; RSL `polibatam2025`), operacionalizado pela **decisão L04 = B**: `tc netem` encapsulado em Docker. Roda na VM Linux do Docker Desktop, sem necessidade de VM Linux separada no macOS/Windows.

### Como funciona

No lab de benchmark (`docker-compose.bench.yml`), API e NGINX rodam como containers na mesma rede Docker `bench` (subnet `172.30.0.0/16`, IPs fixos `api=172.30.0.10`, `nginx=172.30.0.20`). Os scripts em `benchmarks/netem/` aplicam `tc netem` no egress de cada container, **apenas no tráfego voltado ao cliente**:

- `tc` usa uma qdisc `prio` cujo default cai na banda com `netem` (latência/perda);
- um filtro `u32` desvia o tráfego destinado ao **IP do peer interno** (hop NGINX↔API) para uma banda limpa.

Assim H/1.1, H/2 e H/3 sofrem a mesma degradação na perna cliente↔servidor, sem penalizar em dobro o caminho do proxy.

> **Por que não Toxiproxy/proxy TCP:** HTTP/3 usa QUIC sobre UDP, e ferramentas de impairment TCP não degradam esse caminho. `tc netem` cobre TCP e UDP.

### Perfis (`benchmarks/netem/profiles.sh`)

| Perfil | netem | Cenário |
|--------|-------|---------|
| `clean` | (nenhum) | Baseline ideal (controle) |
| `lag_100ms` | `delay 100ms` | Latência (RTT) |
| `loss_1pct` | `loss 1%` | Perda de pacotes |
| `lag_100ms_loss_1pct` | `delay 100ms loss 1%` | Combinação |

### Submatriz (R06)

- Endpoint `/bench/ping`, 50 VUs, protocolos h1/h2/h3, os 4 perfis acima.
- `quick` = 3 réplicas; `full` = 30 réplicas (mediana + IQR, L05).

### Execução

```bash
# 1. Subir o lab (API + NGINX em containers na rede bench)
docker compose -f docker-compose.bench.yml up --build -d

# 2. Rodar a matriz degradada (aplica/limpa netem por perfil automaticamente)
npm run bench:degraded              # quick (3 réplicas)
npm run bench:degraded -- -RepsMode full   # 30 réplicas

# 3. Agregar (summary.csv agora tem a coluna network_profile)
npm run bench:agg

# 4. Derrubar o lab
docker compose -f docker-compose.bench.yml down
```

Aplicação/remoção manual do impairment (para validação):

```bash
bash benchmarks/netem/apply.sh lag_100ms
bash benchmarks/netem/clear.sh
```

### Validação do impairment (antes de confiar nos números)

Com o lab no ar e um perfil aplicado, confirme que a latência sobe nos três protocolos:

```bash
# H/1.1 (API direta)
curl -s -o /dev/null -w "h1 time_total=%{time_total}\n" http://localhost:3000/bench/ping
# H/2 (NGINX)
curl -k -s -o /dev/null -w "h2 time_total=%{time_total}\n" --http2 https://localhost:8443/bench/ping
# H/3 (cliente QUIC em Docker)
docker run --rm --add-host=host.docker.internal:host-gateway alpine/curl-http3 \
  curl -k -s -o /dev/null -w "h3 time_total=%{time_total}\n" --http3-only https://host.docker.internal:8443/bench/ping
```

Com `lag_100ms`, `time_total` deve subir ~0.1s acima do `clean` nos três. Se só h1/h2 mudarem e h3 não (ou vice-versa), revise a interface/subnet nos scripts de netem.

### Pré-requisitos

- Docker Desktop em execução; `pwsh` e `k6` instalados (mesmos pré-requisitos dos demais benchmarks); `bash` disponível.

## Troubleshooting

| Problema | Ação |
|----------|------|
| k6 não encontrado | Instale k6 e reinicie o terminal |
| `connection refused` em :3000 | Suba a API com `BENCHMARK_MODE=true` |
| H/2/H/3 falham em :8443 | `npm run dev:nginx` ou `npm run proxy:up` |
| HTTP/3 Docker falha | Verifique UDP 8443; teste curl manual acima |
| Rate limit nos testes | Confirme `BENCHMARK_MODE=true` no `.env` |
| `summary` vazio no agg | Rode `bench:run` antes; JSON na pasta da campanha (`*_rNN.json`); use `bench:agg -- <caminho>` se não for a mais recente |
| netem sem efeito | Containers precisam de `NET_ADMIN` e `iproute2` (já no `docker-compose.bench.yml` / Dockerfiles); valide com os `curl` da seção Rede degradada |
| netem só afeta 1 protocolo | Confirme que subiu com `docker-compose.bench.yml` (API em container, não no host) |

## Rastreabilidade TCC

| Matriz | Artefato |
|--------|----------|
| R03 | Este README + caminhos H/1.1 / H/2 / H/3 |
| R04 | `scripts/run-all.ps1` + `k6/*.js` |
| R05 | Cenários `payload` e `echo` na matriz |
| R06 | `docker-compose.bench.yml` + `netem/` + `scripts/run-degraded.ps1` (seção "Rede degradada") |
| R08 | `npm run bench:run` + `npm run bench:agg` |
