param(
    [ValidateSet('quick', 'full')]
    [string]$RepsMode = 'quick',

    # Numero customizado de replicas. Se > 0, sobrepoe $RepsMode.
    [int]$Reps = 0,

    [ValidateSet('all', 'h1', 'h2', 'h3')]
    [string]$Proto = 'all',

    [int]$Duration = 60,
    [int]$Ramp = 10,
    [string]$Seed = '',

    [int]$CooldownSec = 180,

    [string]$ComposeFile = 'docker-compose.bench.yml',

    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'campaign.ps1')

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$h2loadScript = Join-Path $repoRoot 'benchmarks\h2load\run-h2load.ps1'

$reps = if ($Reps -gt 0) { $Reps } elseif ($RepsMode -eq 'full') { 30 } else { 3 }
if (-not $Seed) {
    $Seed = [guid]::NewGuid().ToString('N').Substring(0, 8)
}

$resultsDir = New-CampaignResultsDir -RepoRoot $repoRoot

Write-CampaignManifest -CampaignDir $resultsDir -Metadata @{
    campaign                = 'ideal_matrix'
    tool                    = 'h2load'
    network_profile         = 'clean'
    seed                    = $Seed
    reps                    = $reps
    duration_sec            = $Duration
    warmup_sec              = $Ramp
    cooldown_sec            = if ($NoPause) { 0 } else { $CooldownSec }
    proto                   = $Proto
    base_url                = 'https://nginx:8443'
    clients                 = '-c = load'
    max_concurrent_streams  = 1
    threads                 = 1
    nginx_keepalive_requests = 1000000
    started_at              = (Get-Date).ToUniversalTime().ToString('o')
}

function Assert-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Comando obrigatorio nao encontrado: $Name"
    }
}

function Test-StackHealthy {
    $codeApi = (curl.exe -s -o NUL -w '%{http_code}' http://localhost:3000/bench/ping 2>$null).Trim()
    $codeNginx = (curl.exe -k -s -o NUL -w '%{http_code}' https://localhost:8443/bench/ping 2>$null).Trim()
    $h1Probe = (curl.exe -k --http1.1 -s -o NUL -w '%{http_code} %{http_version}' https://localhost:8443/bench/ping 2>$null).Trim()
    return ($codeApi -eq '200' -and $codeNginx -eq '200' -and $h1Probe -eq '200 1.1')
}

function Assert-StackHealthy {
    param([int]$Attempts = 5, [int]$DelaySec = 3)

    for ($i = 1; $i -le $Attempts; $i++) {
        if (Test-StackHealthy) {
            return
        }
        Write-Host "Aguardando stack saudavel (tentativa $i/$Attempts)..."
        Start-Sleep -Seconds $DelaySec
    }
    throw 'Stack nao saudavel: http://localhost:3000/bench/ping ou https://localhost:8443/bench/ping (HTTP/1.1 na 8443 deve responder http_version 1.1)'
}

function Restart-BenchStack {
    $composePath = Join-Path $repoRoot $ComposeFile
    Write-Host "Reiniciando lab: docker compose -f $ComposeFile restart"
    & docker compose -f $composePath restart
    Start-Sleep -Seconds 20
}

function Ensure-StackHealthyBeforeReplica {
    param([int]$Rep)

    if (Test-StackHealthy) {
        return
    }
    Write-Warning "Stack indisponivel antes da replica $Rep; tentando restart do lab bench..."
    Restart-BenchStack
    Assert-StackHealthy -Attempts 15 -DelaySec 4
}

function Invoke-H2LoadScenario {
    param(
        [string]$ProtoName,
        [string]$EndpointKind,
        [string]$EndpointTag,
        [int]$Load,
        [int]$Rep,
        [string]$Size = '1kb',
        [int]$BodyBytes = 0,
        [string]$NetworkProfile = 'clean'
    )

    $outFile = Join-Path $resultsDir "${ProtoName}_${EndpointTag}_${Load}_r$($Rep.ToString('00')).json"

    & $h2loadScript `
        -Proto $ProtoName `
        -Endpoint $EndpointKind `
        -EndpointTag $EndpointTag `
        -Load $Load `
        -Duration $Duration `
        -Warmup $Ramp `
        -Rep $Rep `
        -Size $Size `
        -BodyBytes $BodyBytes `
        -Out $outFile `
        -Seed $Seed `
        -NetworkProfile $NetworkProfile `
        -ComposeFile $ComposeFile

    if (Test-Path $outFile) {
        Assert-ObservedProto -SummaryPath $outFile -ProtoName $ProtoName
    }
}

$pingLoads = @(10, 50, 100)
$payloadSizes = @('1kb', '100kb', '1mb')
$payloadLoad = 50
$echoLoad = 50

$cells = @()
foreach ($load in $pingLoads) {
    $cells += @{ Kind = 'ping'; Tag = 'ping'; Load = $load; Size = '1kb'; BodyBytes = 0 }
}
foreach ($size in $payloadSizes) {
    $cells += @{ Kind = 'payload'; Tag = "payload_$size"; Load = $payloadLoad; Size = $size; BodyBytes = 0 }
}
$cells += @{ Kind = 'echo'; Tag = 'echo'; Load = $echoLoad; Size = '1kb'; BodyBytes = 102400 }

$protocols = @()
if ($Proto -in @('all', 'h3')) { $protocols += 'h3' }
if ($Proto -in @('all', 'h2')) { $protocols += 'h2' }
if ($Proto -in @('all', 'h1')) { $protocols += 'h1' }

$totalRuns = $protocols.Count * $cells.Count * $reps
$secondsPerRun = $Ramp + $Duration + 5
$estimateMin = [math]::Round(($totalRuns * $secondsPerRun) / 60, 1)

Write-Host '=== Benchmark matrix ==='
Write-Host "REPS=$reps ($RepsMode) | PROTO=$Proto | SEED=$Seed"
Write-Host "Campanha: $resultsDir"
Write-Host "Gerador: h2load | -c = load | -m 1 | -t 1 | -D ${Duration}s | warm-up ${Ramp}s"
if (-not $NoPause -and $reps -gt 1) {
    Write-Host "Pausa entre réplicas: ${CooldownSec}s (use -NoPause para execução contínua; -CooldownSec 0 para Enter manual)"
}
Write-Host "h2load runs: $totalRuns | estimativa: ~${estimateMin} min"
Write-Host ''
Write-Host 'Certifique-se de que o lab bench esta no ar:'
Write-Host "  docker compose -f $ComposeFile up --build -d"
Write-Host ''

Assert-Command -Name 'curl.exe'
Assert-Command -Name 'docker'
Assert-StackHealthy -Attempts 10 -DelaySec 3

Write-Host 'Construindo imagem h2load (usa cache se a imagem já existir)...'
& docker compose -f (Join-Path $repoRoot $ComposeFile) --profile load build h2load
if ($LASTEXITCODE -ne 0) {
    throw 'build da imagem h2load falhou'
}

for ($rep = 1; $rep -le $reps; $rep++) {
    Write-Host "--- Replica $rep / $reps ---"
    Ensure-StackHealthyBeforeReplica -Rep $rep

    foreach ($protoName in $protocols) {
        foreach ($cell in $cells) {
            Invoke-H2LoadScenario `
                -ProtoName $protoName `
                -EndpointKind $cell.Kind `
                -EndpointTag $cell.Tag `
                -Load $cell.Load `
                -Rep $rep `
                -Size $cell.Size `
                -BodyBytes $cell.BodyBytes
        }
    }

    Wait-ForNextReplica -CompletedRep $rep -TotalReps $reps -NoPause:$NoPause -CooldownSec $CooldownSec
}

Write-Host ''
Write-Host "Benchmarks concluidos. Campanha: $resultsDir"
Write-Host "Agregue com: npm run bench:agg -- $resultsDir"
