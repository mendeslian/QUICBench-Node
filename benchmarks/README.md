# Benchmarks — comparação HTTP/1.1 / HTTP/2 / HTTP/3

Roteiro reproduzível para o estudo de caso do TCC (Cap. 4–5). Os scripts medem as rotas `/bench/ping`, `/bench/payload/:size` e `POST /bench/echo` com o mesmo contrato REST nos três caminhos de protocolo.

## Decisões experimentais

| Lacuna | Decisão |
|--------|---------|
| **L01** | 10 / 50 / 100 clientes (`-c` do h2load), patamar de 60 s (`-D`), aquecimento de 10 s (`--warm-up-time`). O aquecimento é descartado da taxa. Não é o ramp-up de VUs do k6 |
| **L03** | H/1.1 (`--h1`), H/2 (`--alpn-list=h2`) e H/3 (`--h3`) no mesmo h2load, contra `https://nginx:8443` na rede `bench`. As campanhas `2026-10-01_08-38-06` e `2026-10-15_10-13-06` usaram k6 e curl, e mediram H/1.1 em `http://localhost:3000` |
| **L04** | Rede degradada via `tc netem` em Docker (ver seção "Rede degradada (R06)") |
| **L05** | 30 réplicas por célula (modo `full`); mediana + IQR via `bench:agg` |

## Arquitetura dos caminhos

```text
HTTP/1.1  →  https://nginx:8443/bench/*     (h2load --h1)
HTTP/2    →  https://nginx:8443/bench/*     (h2load --alpn-list=h2)
HTTP/3    →  https://nginx:8443/bench/*     (h2load --h3)
```

O binário é o mesmo nos três. `-c` é o número de clientes, `-m 1` deixa um stream em voo por sessão, `-t 1` fixa uma thread. No NGINX do lab, `keepalive_requests` está em 1000000: o default 1000 fecha a conexão e o h2load não abre outra, então o patamar de 60 s mediria só esse prefixo. `data_received_rate` no JSON da campanha é o `bytes_per_second` do h2load (`bytes_total / duração do patamar`, cabeçalhos e corpo). `http_req_waiting_*` fica vazio: o TTFB do h2load é um valor por conexão, não por requisição.

As pastas `k6/` e `http3/` continuam no repositório. As campanhas de outubro de 2026 foram feitas com elas.

## Pré-requisitos

- Node.js ≥ 18, Docker, PowerShell 7 (`pwsh`)
- API com `BENCHMARK_MODE=true` (desabilita rate limiter)
- Proxy NGINX para H/1.1, H/2 e H/3: `npm run dev:nginx`

### Variáveis de ambiente (`.env`)

```env
BENCHMARK_MODE=true
# Opcional: export NDJSON da API durante os testes
# METRICS_FILE=benchmarks/results/metrics.ndjson
```

## Validação manual dos três protocolos

Com API + proxy rodando:

```bash
# HTTP/1.1 (via NGINX, ALPN http/1.1)
curl -k -s --http1.1 https://localhost:8443/bench/ping

# HTTP/2 (via NGINX, ALPN h2)
curl -k -s --http2 https://localhost:8443/bench/ping

# HTTP/3 (via NGINX QUIC) — requer curl com suporte HTTP/3
docker run --rm --add-host=host.docker.internal:host-gateway alpine/curl-http3 \
  curl -k -s --http3-only https://host.docker.internal:8443/bench/ping
```

Confirme `res.proto` no k6: `HTTP/1.1` para H/1.1 e `HTTP/2.0` para H/2.

## Alt-Svc e fallback

Sonda de 4 de novembro de 2026, no modo host. A API subiu com `npm run dev`. O NGINX subiu com `docker compose -p quicbench-host -f docker-compose.yml up -d --build nginx`, publicando 8443/tcp e 8443/udp. O cliente foi a imagem `alpine/curl-http3` (curl 8.11.0-DEV, quiche 0.22.0). Os arquivos estão em `benchmarks/results/alt-svc-fallback/2026-11-04_01-30-34/`. O script `benchmarks/http3/check-alt-svc.ps1` grava cabeçalhos, corpo, verbose, `http_version` e o access log.

```powershell
pwsh -File benchmarks/http3/check-alt-svc.ps1 -Phase discover
```

A fase `discover` faz duas chamadas a `https://host.docker.internal:8443/bench/ping`. A primeira é `curl -k --http2 --alt-svc`, com cache vazio. A segunda repete a URL com o mesmo cache, sem `--http2` e sem `--http3`. Nessa pasta, o access log às 04:30:36 UTC tem `protocol="HTTP/2.0"` e `h3=""`. Às 04:30:39 UTC tem `protocol="HTTP/3.0"` e `h3="h3"`. As duas respostas trouxeram `alt-svc: h3=":8443"; ma=2592000` e `{"ok":true}`. O arquivo `nginx-2.txt` também contém a linha das 04:30:36 UTC.

A terceira chamada usou o cache já gravado, com o NGINX recriado só em TCP. O override está em `tcp-only.override.yml` nessa pasta. Na execução ele foi passado a partir de `%TEMP%\quicbench-tcp-only.yml`, com o mesmo conteúdo.

```powershell
docker compose -p quicbench-host -f docker-compose.yml -f %TEMP%\quicbench-tcp-only.yml up -d --force-recreate --no-deps nginx
pwsh -File benchmarks/http3/check-alt-svc.ps1 -Phase fallback -OutDir benchmarks/results/alt-svc-fallback/2026-11-04_01-30-34
```

`compose-ps-fallback.txt` lista só `8443/tcp`. A requisição terminou com `http_version=2`, status 200, `protocol="HTTP/2.0"` e `h3=""`, às 04:31:17 UTC. O verbose dessa chamada não tem linha de erro QUIC.

A publicação dos dois protocolos voltou em seguida. A checagem usa `--http3-only` e não usa `--alt-svc`.

```powershell
docker compose -p quicbench-host -f docker-compose.yml up -d --force-recreate --no-deps nginx
pwsh -File benchmarks/http3/check-alt-svc.ps1 -Phase restore-check -OutDir benchmarks/results/alt-svc-fallback/2026-11-04_01-30-34
```

Às 04:31:57 UTC o access log registrou `protocol="HTTP/3.0"` e `h3="h3"`, status 200.

## Estrutura

```text
benchmarks/
  h2load/
    Dockerfile       # nghttp2 v1.70.0 com HTTP/3 (aws-lc, nghttp3, ngtcp2)
    run-h2load.ps1   # uma célula: h1, h2 ou h3
    map-summary.ts   # --output-file do h2load → schema da campanha
  k6/                # campanhas de outubro de 2026; a campanha atual não chama
  http3/             # cliente curl das campanhas de outubro; a campanha atual não chama
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
# API e NGINX na rede bench. O h2load entra nessa rede e fala com https://nginx:8443.
docker compose -f docker-compose.bench.yml up --build -d
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

**Pausa entre réplicas:** por padrão, **180 s** de resfriamento após cada réplica da matriz ideal (`-CooldownSec`). Com `-Reps 1` não há pausa. Use `-NoPause` para execução contínua ou `-CooldownSec 0` para pausa manual (Enter). A submatriz degradada do TCC usa `-NoPause` (sem intervalo).

Parâmetros do runner (`benchmarks/scripts/run-all.ps1`; `run-degraded.ps1` aceita os mesmos `-NoPause`, `-Reps` e `-CooldownSec`):

| Parâmetro | Valores | Padrão |
|-----------|---------|--------|
| `-RepsMode` | `quick` (3), `full` (30) | `quick` |
| `-Reps` | inteiro; se > 0, substitui `-RepsMode` | `0` |
| `-Proto` | `all`, `h1`, `h2`, `h3` | `all` |
| `-Duration` | segundos | `60` |
| `-Ramp` | segundos de `--warm-up-time` (não é ramp-up de VUs) | `10` |
| `-CooldownSec` | segundos entre réplicas, matriz ideal | `180` |
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

A mediana e o IQR descrevem a célula. Para comparar HTTP/2 com HTTP/3 na mesma condição (endpoint, VUs e perfil de rede), use `npm run bench:compare`. O script lê os JSON da campanha e grava `h2-h3-tests.csv` e `h2-h3-tests.json`, com U de Mann-Whitney da amostra HTTP/2, delta de Cliff e p bilateral das métricas `http_req_duration_p95` e `http_reqs_rate`. O p é exato quando nenhum valor de HTTP/2 coincide com um valor de HTTP/3.

```bash
npm run bench:compare -- benchmarks/results/2026-10-15_10-13-06
```

### 4. Uma célula com h2load

O lab `docker-compose.bench.yml` precisa estar no ar. O cliente entra na rede `bench` e fala com `https://nginx:8443`.

```powershell
pwsh benchmarks/h2load/run-h2load.ps1 -Proto h1 -Endpoint ping -Load 10 -Duration 5 -Warmup 1 -Rep 1
pwsh benchmarks/h2load/run-h2load.ps1 -Proto h2 -Endpoint payload -Size 1kb -Load 50 -Rep 1
pwsh benchmarks/h2load/run-h2load.ps1 -Proto h3 -Endpoint echo -Load 50 -BodyBytes 102400 -Rep 1
```

Os scripts em `k6/` e `benchmarks/http3/` reproduzem o gerador das campanhas de outubro. A matriz atual não os chama.

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
    "tool": "h2load"
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

Métricas alinhadas ao §2.8 do TCC: latência e tempo de resposta (`http_req_duration`, em ms, a partir dos segundos de `performance.request`), req/s (`http_reqs_rate` = `request_per_second` do patamar) e throughput (`data_received_rate` = `bytes_per_second`, total de bytes incluindo cabeçalhos). `http_req_waiting_*` fica `null`. `observed_proto` é o protocolo pedido pela flag (`--h1`, `--alpn-list=h2` ou `--h3`). A confirmação de que o NGINX falou esse protocolo está no access log (`protocol="$server_protocol"`).

O summary do k6 2.2.0, nas campanhas arquivadas, não exporta a tag de um contador. O script antigo grava `observed_proto` a partir dos contadores `observed_http11` e `observed_http20`. Nos JSON das campanhas arquivadas esse campo ficou `rate`.

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
# H/1.1 (NGINX, ALPN http/1.1)
curl -k --http1.1 -s -o /dev/null -w "h1 time_total=%{time_total}\n" https://localhost:8443/bench/ping
# H/2 (NGINX, ALPN h2)
curl -k -s -o /dev/null -w "h2 time_total=%{time_total}\n" --http2 https://localhost:8443/bench/ping
# H/3 (h2load na rede bench, célula curta)
pwsh benchmarks/h2load/run-h2load.ps1 -Proto h3 -Endpoint ping -Load 1 -Duration 5 -Warmup 0 -Rep 1
```

Com `lag_100ms`, o `time_total` do curl deve subir cerca de 0,1 s acima do `clean` em H/1.1 e H/2. No H/3, o `p95_ms` impresso pelo conversor do h2load deve subir na mesma ordem. Se só uma parte mudar, revise a interface e a subnet nos scripts de netem.

### Pré-requisitos

- Docker Desktop em execução; `pwsh` e `bash` disponíveis. A imagem `quicbench-h2load:1.70.0` é construída pelo runner.

## Troubleshooting

| Problema | Ação |
|----------|------|
| Imagem h2load ausente ou sem `--h3` | `docker compose -f docker-compose.bench.yml --profile load build h2load` e confira `h2load --help` |
| `connection refused` em :3000 | Suba o lab com `docker compose -f docker-compose.bench.yml up --build -d` |
| H/1.1, H/2 ou H/3 falham em :8443 | O lab bench publica 8443/tcp e 8443/udp. Confira o access log do NGINX |
| HTTP/3 não conecta | UDP na rede `bench` até `nginx:8443`. Rode primeiro uma célula curta com `-Proto h3` |
| Rate limit nos testes | Confirme `BENCHMARK_MODE=true` no `.env` |
| `summary` vazio no agg | Rode `bench:run` antes; JSON na pasta da campanha (`*_rNN.json`); use `bench:agg -- <caminho>` se não for a mais recente |
| netem sem efeito | Containers precisam de `NET_ADMIN` e `iproute2` (já no `docker-compose.bench.yml` / Dockerfiles); valide com os `curl` da seção Rede degradada |
| netem só afeta 1 protocolo | Confirme que subiu com `docker-compose.bench.yml` (API em container, não no host) |

## Rastreabilidade TCC

| Matriz | Artefato |
|--------|----------|
| R03 | Este README + caminhos H/1.1 / H/2 / H/3 |
| R04 | `scripts/run-all.ps1` + `h2load/run-h2load.ps1` |
| R05 | Cenários `payload` e `echo` na matriz |
| R06 | `docker-compose.bench.yml` + `netem/` + `scripts/run-degraded.ps1` (seção "Rede degradada") |
| R08 | `npm run bench:run` + `npm run bench:agg` |
