# Sonda de uma célula: GET /bench/ping, 50 VUs, 60 s, rede clean.
# Compara o time_total do cliente QUIC com request_time/upstream_response_time
# do NGINX e amostra a CPU do contêiner do cliente no mesmo intervalo.
# Não altera run-all.ps1 nem run-degraded.ps1.

param(
    [int]$Load = 50,
    [int]$Duration = 60,
    [string]$ContainerName = 'h3-client-probe',
    [string]$ImageName = 'http3-bench-client',
    [string]$ComposeFile = 'docker-compose.bench.yml',
    [string]$OutDir = '',
    [switch]$SummarizeOnly
)

$ErrorActionPreference = 'Stop'
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}
$inv = [System.Globalization.CultureInfo]::InvariantCulture

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$http3Dir = Join-Path $repoRoot 'benchmarks\http3'
$composePath = Join-Path $repoRoot $ComposeFile

if (-not $OutDir) {
    $OutDir = Join-Path $repoRoot 'benchmarks\results\probe-h3-client-split'
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$stdoutPath = Join-Path $OutDir 'client-stdout.txt'
$stderrPath = Join-Path $OutDir 'client-stderr.txt'
$clientJsonPath = Join-Path $OutDir 'client-summary.json'
$nginxPath = Join-Path $OutDir 'nginx-access.txt'
$statsCsv = Join-Path $OutDir 'docker-stats.csv'
$summaryPath = Join-Path $OutDir 'nginx-timing-summary.json'
$samplePath = Join-Path $OutDir 'nginx-h3-sample.txt'

function Get-RankPercentile {
    param([double[]]$Sorted, [double]$P)
    $n = $Sorted.Length
    if ($n -eq 0) { return $null }
    # Mesmo posto do cliente (benchmarks/http3/run-load.sh).
    $idx = [int][Math]::Floor(($P / 100.0) * $n + 0.999999) - 1
    if ($idx -lt 0) { $idx = 0 }
    if ($idx -ge $n) { $idx = $n - 1 }
    return $Sorted[$idx]
}

function Convert-CpuPercent {
    param([string]$Text)
    $t = $Text.Trim().TrimEnd('%').Replace(',', '.')
    return [double]::Parse($t, $inv)
}

function Get-H3Field {
    param([string]$Line)
    if ($Line -match 'protocol="HTTP/3') { return 'protocol' }
    if ($Line -match 'h3="h3"') { return 'h3' }
    if ($Line -match 'HTTP/3') { return 'request_line' }
    return $null
}

function Write-ProbeSummary {
    $nginxLines = @(Get-Content -Path $nginxPath -ErrorAction SilentlyContinue)
    if (-not $nginxLines -or $nginxLines.Count -eq 0) {
        throw "Access log vazio: $nginxPath"
    }

    $grouped = @{}
    foreach ($line in $nginxLines) {
        $field = Get-H3Field -Line $line
        if (-not $field) { continue }
        if (-not $grouped.ContainsKey($field)) {
            $grouped[$field] = New-Object System.Collections.Generic.List[string]
        }
        $grouped[$field].Add($line)
    }

    $matchField = $null
    foreach ($candidate in @('protocol', 'h3', 'request_line')) {
        if ($grouped.ContainsKey($candidate) -and $grouped[$candidate].Count -gt 0) {
            $matchField = $candidate
            break
        }
    }
    if (-not $matchField) {
        $preview = ($nginxLines | Select-Object -First 15) -join "`n"
        throw "Nenhuma linha HTTP/3 no access log. Primeiras linhas:`n$preview"
    }

    $h3Lines = $grouped[$matchField]
    $h3Lines | Select-Object -First 5 | Set-Content -Path $samplePath -Encoding utf8

    $requestTimes = New-Object System.Collections.Generic.List[double]
    $upstreamTimes = New-Object System.Collections.Generic.List[double]
    $above100 = 0
    $maxRequestMs = $null
    $maxRequestUpstreamMs = $null
    foreach ($line in $h3Lines) {
        $requestMs = $null
        $upstreamMs = $null
        if ($line -match 'request_time="([0-9]+(?:\.[0-9]+)?)"') {
            $requestMs = [double]::Parse($Matches[1], $inv) * 1000.0
            $requestTimes.Add($requestMs)
            if ($requestMs -gt 100) { $above100++ }
        }
        if ($line -match 'upstream_time="([^"]*)"' -and $Matches[1] -match '([0-9]+(?:\.[0-9]+)?)') {
            $upstreamMs = [double]::Parse($Matches[1], $inv) * 1000.0
            $upstreamTimes.Add($upstreamMs)
        }
        if ($null -ne $requestMs -and (($null -eq $maxRequestMs) -or ($requestMs -gt $maxRequestMs))) {
            $maxRequestMs = $requestMs
            $maxRequestUpstreamMs = $upstreamMs
        }
    }
    if ($requestTimes.Count -eq 0) {
        throw "Linhas HTTP/3 sem request_time (campo usado: $matchField)."
    }

    $reqSorted = @($requestTimes | Sort-Object)
    $upSorted = @($upstreamTimes | Sort-Object)

    $clientRaw = Get-Content -Path $stdoutPath -Raw
    $jsonLine = $null
    foreach ($line in ($clientRaw -split "`r?`n")) {
        $trim = $line.Trim()
        if ($trim.StartsWith('{')) { $jsonLine = $trim }
    }
    if (-not $jsonLine) {
        throw "stdout do cliente sem JSON: $stdoutPath"
    }
    $client = $jsonLine | ConvertFrom-Json
    $client | ConvertTo-Json -Depth 6 | Set-Content -Path $clientJsonPath -Encoding utf8

    $cpuValues = New-Object System.Collections.Generic.List[double]
    $statRows = @(Get-Content -Path $statsCsv -ErrorAction SilentlyContinue | Select-Object -Skip 1)
    foreach ($row in $statRows) {
        if (-not $row) { continue }
        $cols = $row.Split(',')
        if ($cols.Length -lt 2) { continue }
        $cpuText = $cols[1].Trim()
        if (-not $cpuText -or $cpuText -eq '--') { continue }
        $cpuValues.Add((Convert-CpuPercent $cpuText))
    }
    if ($cpuValues.Count -eq 0) {
        throw "docker stats nao viu o contêiner $ContainerName ($statsCsv)."
    }

    $cpuMean = ($cpuValues | Measure-Object -Average).Average
    $cpuPeak = ($cpuValues | Measure-Object -Maximum).Maximum

    $round3 = {
        param($v)
        if ($null -eq $v) { return $null }
        return [Math]::Round([double]$v, 3)
    }

    $summary = [ordered]@{
        endpoint = 'ping'
        load = $Load
        duration_sec = $Duration
        network_profile = 'clean'
        container_name = $ContainerName
        h3_match_field = $matchField
        nginx_h3_lines = $h3Lines.Count
        request_time_n = $requestTimes.Count
        request_time_p50_ms = & $round3 (Get-RankPercentile -Sorted $reqSorted -P 50)
        request_time_p95_ms = & $round3 (Get-RankPercentile -Sorted $reqSorted -P 95)
        request_time_min_ms = & $round3 $reqSorted[0]
        request_time_max_ms = & $round3 $reqSorted[$reqSorted.Length - 1]
        request_time_above_100ms = $above100
        request_time_max_upstream_ms = & $round3 $maxRequestUpstreamMs
        upstream_time_n = $upstreamTimes.Count
        upstream_time_p50_ms = & $round3 (Get-RankPercentile -Sorted $upSorted -P 50)
        upstream_time_p95_ms = & $round3 (Get-RankPercentile -Sorted $upSorted -P 95)
        upstream_time_min_ms = & $round3 $(if ($upSorted.Length -gt 0) { $upSorted[0] } else { $null })
        upstream_time_max_ms = & $round3 $(if ($upSorted.Length -gt 0) { $upSorted[$upSorted.Length - 1] } else { $null })
        client_http_req_duration_p50_ms = & $round3 $client.http_req_duration_p50
        client_http_req_duration_p95_ms = & $round3 $client.http_req_duration_p95
        client_http_req_duration_avg_ms = & $round3 $client.http_req_duration_avg
        client_http_reqs_rate = & $round3 $client.http_reqs_rate
        client_http_reqs_count = $client.http_reqs_count
        cpu_samples = $cpuValues.Count
        cpu_mean_percent = & $round3 $cpuMean
        cpu_peak_percent = & $round3 $cpuPeak
        cpu_note = 'docker stats CPU%: 100% equivale a um nucleo'
    }

    $summary | ConvertTo-Json -Depth 4 | Set-Content -Path $summaryPath -Encoding utf8
    Write-Host "[probe] campo HTTP/3: $matchField; linhas=$($h3Lines.Count); amostras CPU=$($cpuValues.Count)"
    Write-Host "[probe] resumo: $summaryPath"
    return $summary
}

if ($SummarizeOnly) {
    Write-ProbeSummary | Out-Host
    return
}

function Assert-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Comando obrigatorio nao encontrado: $Name"
    }
}

Assert-Command 'docker'
Assert-Command 'curl.exe'

Write-Host "[probe] subindo stack: docker compose -f $ComposeFile up -d"
& docker compose -f $composePath up -d
if ($LASTEXITCODE -ne 0) {
    throw "docker compose up falhou (exit $LASTEXITCODE)"
}

$healthy = $false
for ($i = 1; $i -le 30; $i++) {
    $codeH1 = curl.exe -s -o NUL -w '%{http_code}' http://localhost:3000/bench/ping 2>$null
    $codeH2 = curl.exe -k -s -o NUL -w '%{http_code}' https://localhost:8443/bench/ping 2>$null
    if ($codeH1 -eq '200' -and $codeH2 -eq '200') {
        $healthy = $true
        break
    }
    Write-Host "[probe] aguardando stack ($i/30); h1=$codeH1 h2=$codeH2"
    Start-Sleep -Seconds 4
}
if (-not $healthy) {
    throw 'Stack nao saudavel: http://localhost:3000/bench/ping ou https://localhost:8443/bench/ping'
}

Write-Host '[probe] removendo netem residual (clean)'
foreach ($svc in @('api', 'nginx')) {
    & docker compose -f $composePath exec -T $svc sh -c 'tc qdisc del dev eth0 root 2>/dev/null || true'
}

Write-Host "[probe] build da imagem $ImageName"
& docker build -t $ImageName -f (Join-Path $http3Dir 'Dockerfile') $repoRoot
if ($LASTEXITCODE -ne 0) {
    throw "docker build falhou (exit $LASTEXITCODE)"
}

& docker rm -f $ContainerName 2>$null | Out-Null

$nginxId = (& docker compose -f $composePath ps -q nginx).Trim()
if (-not $nginxId) {
    throw 'Container nginx nao encontrado.'
}

$targetUrl = 'https://host.docker.internal:8443/bench/ping'
$dockerArgs = @(
    'run', '--rm', '--name', $ContainerName,
    '--add-host=host.docker.internal:host-gateway',
    '-v', "${http3Dir}:/bench:ro",
    $ImageName, $targetUrl, "$Load", "$Duration", 'GET'
)

$sinceUtc = (Get-Date).ToUniversalTime().AddSeconds(-2)
$sinceArg = $sinceUtc.ToString('yyyy-MM-ddTHH:mm:ss') + 'Z'
$startedAt = (Get-Date).ToUniversalTime().ToString('o')

Write-Host "[probe] GET /bench/ping load=$Load duration=${Duration}s container=$ContainerName"
$proc = Start-Process -FilePath 'docker' -ArgumentList $dockerArgs -WorkingDirectory $repoRoot `
    -PassThru -NoNewWindow -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath

$statsRows = New-Object System.Collections.Generic.List[string]
$statsRows.Add('timestamp_utc,cpu_percent,mem_usage')
$deadline = (Get-Date).AddSeconds($Duration + 90)
while (-not $proc.HasExited) {
    if ((Get-Date) -gt $deadline) {
        & docker rm -f $ContainerName 2>$null | Out-Null
        throw "Sonda excedeu $($Duration + 90)s"
    }
    $raw = & docker stats --no-stream --format '{{.CPUPerc}}|{{.MemUsage}}' $ContainerName 2>$null
    if ($LASTEXITCODE -eq 0 -and $raw) {
        $text = [string]$raw
        $bar = $text.IndexOf('|')
        if ($bar -ge 0) {
        $cpu = $text.Substring(0, $bar).Trim()
        $mem = $text.Substring($bar + 1).Trim()
        if ($cpu -and $cpu -ne '--') {
            $ts = (Get-Date).ToUniversalTime().ToString('o')
            $statsRows.Add(('{0},{1},"{2}"' -f $ts, $cpu, $mem))
            if (($statsRows.Count % 10) -eq 0) {
                Write-Host "[probe] amostras CPU=$($statsRows.Count - 1) ultima=$cpu"
            }
        }
        }
    }
    Start-Sleep -Seconds 1
}
$proc.WaitForExit()
$statsRows | Set-Content -Path $statsCsv -Encoding utf8

if ($proc.ExitCode -ne 0) {
    $err = ''
    if (Test-Path $stderrPath) { $err = Get-Content -Path $stderrPath -Raw }
    $out = ''
    if (Test-Path $stdoutPath) { $out = Get-Content -Path $stdoutPath -Raw }
    throw "Cliente HTTP/3 falhou (exit $($proc.ExitCode)). stderr=$err stdout=$out"
}

Write-Host "[probe] coletando logs do nginx desde $sinceArg"
& docker logs --since $sinceArg --timestamps $nginxId 2>&1 | Out-File -FilePath $nginxPath -Encoding utf8

$meta = [ordered]@{
    started_at = $startedAt
    ended_at = (Get-Date).ToUniversalTime().ToString('o')
    since_arg = $sinceArg
    nginx_container_id = $nginxId
    load = $Load
    duration_sec = $Duration
    container_name = $ContainerName
}
$meta | ConvertTo-Json | Set-Content -Path (Join-Path $OutDir 'probe-meta.json') -Encoding utf8

Write-ProbeSummary | Out-Host
