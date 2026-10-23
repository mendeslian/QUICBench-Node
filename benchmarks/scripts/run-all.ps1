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

    [int]$CooldownSec = 600,

    [string]$ComposeFile = 'docker-compose.bench.yml',

    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'campaign.ps1')

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$k6Dir = Join-Path $repoRoot 'benchmarks\k6'
$h3Script = Join-Path $repoRoot 'benchmarks\http3\run-h3.ps1'

$reps = if ($Reps -gt 0) { $Reps } elseif ($RepsMode -eq 'full') { 30 } else { 3 }
if (-not $Seed) {
    $Seed = [guid]::NewGuid().ToString('N').Substring(0, 8)
}

$resultsDir = New-CampaignResultsDir -RepoRoot $repoRoot

Write-CampaignManifest -CampaignDir $resultsDir -Metadata @{
    campaign   = 'ideal_matrix'
    tool       = 'k6+curl-http3'
    network_profile = 'clean'
    seed       = $Seed
    reps       = $reps
    duration_sec = $Duration
    ramp_sec   = $Ramp
    cooldown_sec = if ($NoPause) { 0 } else { $CooldownSec }
    proto      = $Proto
    started_at = (Get-Date).ToUniversalTime().ToString('o')
}

function Assert-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Comando obrigatorio nao encontrado: $Name"
    }
}

function Test-StackHealthy {
    $codeH1 = curl.exe -s -o NUL -w '%{http_code}' http://localhost:3000/bench/ping 2>$null
    $codeH2 = curl.exe -k -s -o NUL -w '%{http_code}' https://localhost:8443/bench/ping 2>$null
    return ($codeH1 -eq '200' -and $codeH2 -eq '200')
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
    throw 'Stack nao saudavel: http://localhost:3000/bench/ping ou https://localhost:8443/bench/ping'
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

function Get-K6Path {
    if (Get-Command k6 -ErrorAction SilentlyContinue) {
        return 'k6'
    }
    throw 'k6 nao encontrado. Instale: https://grafana.com/docs/k6/latest/set-up/install-k6/'
}

function Invoke-K6Scenario {
    param(
        [string]$Script,
        [string]$ProtoName,
        [string]$Endpoint,
        [int]$Load,
        [int]$Rep,
        [hashtable]$ExtraEnv = @{}
    )

    $outFile = Join-Path $resultsDir "${ProtoName}_${Endpoint}_${Load}_r$($Rep.ToString('00')).json"
    $k6 = Get-K6Path

    $envArgs = @{
        PROTO    = $ProtoName
        ENDPOINT = $Endpoint
        LOAD     = "$Load"
        RAMP     = "$Ramp"
        DURATION = "$Duration"
        REP      = "$Rep"
        SEED     = $Seed
        OUT      = $outFile
    }

    foreach ($key in $ExtraEnv.Keys) {
        $envArgs[$key] = $ExtraEnv[$key]
    }

    $k6Args = @('run', '--no-thresholds')
    foreach ($pair in $envArgs.GetEnumerator()) {
        $k6Args += '--env'
        $k6Args += "$($pair.Key)=$($pair.Value)"
    }
    $k6Args += (Join-Path $k6Dir $Script)

    Write-Host "[k6] $ProtoName $Endpoint load=$Load rep=$Rep"
    & $k6 @k6Args
    if ($LASTEXITCODE -ne 0) {
        if (Test-Path $outFile) {
            Write-Warning "k6 exit=$LASTEXITCODE mas summary gravado: $outFile (continuando)"
        } else {
            throw "k6 falhou: $Script ($ProtoName $Endpoint rep=$Rep)"
        }
    }
}

function Invoke-H3Scenario {
    param(
        [string]$EndpointKind,
        [string]$EndpointTag,
        [int]$Load,
        [int]$Rep,
        [string]$Size = '1kb',
        [int]$BodyBytes = 102400
    )

    $outFile = Join-Path $resultsDir "h3_${EndpointTag}_${Load}_r$($Rep.ToString('00')).json"

    & $h3Script `
        -Endpoint $EndpointKind `
        -Load $Load `
        -Duration $Duration `
        -Rep $Rep `
        -Size $Size `
        -BodyBytes $BodyBytes `
        -Out $outFile `
        -Seed $Seed
}

# Matriz experimental
$pingLoads = @(10, 50, 100)
$payloadSizes = @('1kb', '100kb', '1mb')
$payloadLoad = 50
$echoLoad = 50

$k6Cells = @()
foreach ($load in $pingLoads) {
    $k6Cells += @{ Script = 'ping.js'; Endpoint = 'ping'; Load = $load; Extra = @{} }
}
foreach ($size in $payloadSizes) {
    $k6Cells += @{
        Script   = 'payload.js'
        Endpoint = "payload_$size"
        Load     = $payloadLoad
        Extra    = @{ SIZE = $size }
    }
}
$k6Cells += @{
    Script   = 'echo.js'
    Endpoint = 'echo'
    Load     = $echoLoad
    Extra    = @{ BODY_BYTES = '102400' }
}

$h3Cells = @()
foreach ($load in $pingLoads) {
    $h3Cells += @{ Kind = 'ping'; Tag = 'ping'; Load = $load; Size = '1kb'; BodyBytes = 0 }
}
foreach ($size in $payloadSizes) {
    $h3Cells += @{ Kind = 'payload'; Tag = "payload_$size"; Load = $payloadLoad; Size = $size; BodyBytes = 0 }
}
$h3Cells += @{ Kind = 'echo'; Tag = 'echo'; Load = $echoLoad; Size = '1kb'; BodyBytes = 102400 }

$k6Protocols = @()
if ($Proto -in @('all', 'h1')) { $k6Protocols += 'h1' }
if ($Proto -in @('all', 'h2')) { $k6Protocols += 'h2' }

$runH3 = $Proto -in @('all', 'h3')
$totalK6 = $k6Protocols.Count * $k6Cells.Count * $reps
$totalH3 = if ($runH3) { $h3Cells.Count * $reps } else { 0 }
$secondsPerRun = $Ramp + $Duration + 5
$estimateMin = [math]::Round((($totalK6 + $totalH3) * $secondsPerRun) / 60, 1)

Write-Host '=== Benchmark matrix ==='
Write-Host "REPS=$reps ($RepsMode) | PROTO=$Proto | SEED=$Seed"
Write-Host "Campanha: $resultsDir"
if (-not $NoPause -and $reps -gt 1) {
    Write-Host "Pausa entre réplicas: ${CooldownSec}s (use -NoPause para execução contínua; -CooldownSec 0 para Enter manual)"
}
Write-Host "k6 runs: $totalK6 | h3 runs: $totalH3 | estimativa: ~${estimateMin} min"
Write-Host ''
Write-Host 'Certifique-se de que o lab bench esta no ar:'
Write-Host "  docker compose -f $ComposeFile up --build -d"
Write-Host ''

Assert-Command -Name 'curl.exe'
Assert-StackHealthy -Attempts 10 -DelaySec 3

if ($k6Protocols.Count) {
    Assert-Command -Name (Get-K6Path)
}

if ($runH3) {
    Assert-Command -Name 'docker'
}

for ($rep = 1; $rep -le $reps; $rep++) {
    Write-Host "--- Replica $rep / $reps ---"
    Ensure-StackHealthyBeforeReplica -Rep $rep

    foreach ($protoName in $k6Protocols) {
        foreach ($cell in $k6Cells) {
            Invoke-K6Scenario `
                -Script $cell.Script `
                -ProtoName $protoName `
                -Endpoint $cell.Endpoint `
                -Load $cell.Load `
                -Rep $rep `
                -ExtraEnv $cell.Extra
        }
    }

    if ($runH3) {
        foreach ($cell in $h3Cells) {
            Invoke-H3Scenario `
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
