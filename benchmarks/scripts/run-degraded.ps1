# Runner de benchmark sob rede degradada (R06, decisao L04=B).
#
# Para cada perfil de rede: aplica netem (benchmarks/netem/apply.sh), roda a
# submatriz enxuta (endpoint ping, 50 clientes, protocolos h1/h2/h3 com h2load)
# e remove o impairment (clear.sh) mesmo em caso de falha.
#
# Pre-requisitos:
#   - Lab de benchmark no ar:
#       docker compose -f docker-compose.bench.yml up --build -d
#   - Docker (imagem h2load, profile load)
#   - bash disponivel (macOS/Linux; no Windows use Git Bash/WSL)
#
# Uso:
#   pwsh -File benchmarks/scripts/run-degraded.ps1                # quick (3 reps)
#   pwsh -File benchmarks/scripts/run-degraded.ps1 -RepsMode full # 30 reps
#   pwsh -File benchmarks/scripts/run-degraded.ps1 -Proto h3
#   pwsh -File benchmarks/scripts/run-degraded.ps1 -Profiles clean,lag_100ms

param(
    [ValidateSet('quick', 'full')]
    [string]$RepsMode = 'quick',

    # Numero customizado de replicas. Se > 0, sobrepoe $RepsMode.
    [int]$Reps = 0,

    [ValidateSet('all', 'h1', 'h2', 'h3')]
    [string]$Proto = 'all',

    [int]$Load = 50,
    [int]$Duration = 60,
    [int]$Ramp = 10,
    [string]$Seed = '',

    [string[]]$Profiles = @('clean', 'lag_100ms', 'loss_1pct', 'lag_100ms_loss_1pct'),

    [string]$ComposeFile = 'docker-compose.bench.yml',

    [int]$CooldownSec = 600,

    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'campaign.ps1')

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$netemDir = Join-Path $repoRoot 'benchmarks\netem'
$h2loadScript = Join-Path $repoRoot 'benchmarks\h2load\run-h2load.ps1'
$applyScript = Join-Path $netemDir 'apply.sh'
$clearScript = Join-Path $netemDir 'clear.sh'

$reps = if ($Reps -gt 0) { $Reps } elseif ($RepsMode -eq 'full') { 30 } else { 3 }
if (-not $Seed) {
    $Seed = [guid]::NewGuid().ToString('N').Substring(0, 8)
}

$resultsDir = New-CampaignResultsDir -RepoRoot $repoRoot

Write-CampaignManifest -CampaignDir $resultsDir -Metadata @{
    campaign               = 'degraded_r06'
    tool                   = 'h2load'
    endpoint               = 'ping'
    load                   = $Load
    network_profiles       = ($Profiles -join ',')
    seed                   = $Seed
    reps                   = $reps
    duration_sec           = $Duration
    warmup_sec             = $Ramp
    cooldown_sec           = if ($NoPause) { 0 } else { $CooldownSec }
    proto                  = $Proto
    base_url               = 'https://nginx:8443'
    clients                = '-c = load'
    max_concurrent_streams = 1
    threads                = 1
    nginx_keepalive_requests = 1000000
    started_at             = (Get-Date).ToUniversalTime().ToString('o')
}

$endpoint = 'ping'

function Assert-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Comando obrigatorio nao encontrado: $Name"
    }
}

function Invoke-Netem {
    param([string]$Script, [string]$ProfileArg = '')

    # bash no Windows nao aceita caminhos C:\...; usar relativo a partir da raiz do repo.
    $relScript = switch ($Script) {
        $applyScript { 'benchmarks/netem/apply.sh' }
        $clearScript { 'benchmarks/netem/clear.sh' }
        default { throw "Script netem desconhecido: $Script" }
    }

    Push-Location $repoRoot
    try {
        $bashArgs = @($relScript)
        if ($ProfileArg) { $bashArgs += $ProfileArg }
        & bash @bashArgs
        if ($LASTEXITCODE -ne 0) {
            throw "Falha em $relScript $ProfileArg"
        }
    }
    finally {
        Pop-Location
    }
}

function Invoke-H2LoadPing {
    param([string]$ProtoName, [int]$Rep, [string]$NetworkProfile)

    $outFile = Join-Path $resultsDir "${ProtoName}_${endpoint}_${Load}_${NetworkProfile}_r$($Rep.ToString('00')).json"

    & $h2loadScript `
        -Proto $ProtoName `
        -Endpoint $endpoint `
        -EndpointTag $endpoint `
        -Load $Load `
        -Duration $Duration `
        -Warmup $Ramp `
        -Rep $Rep `
        -NetworkProfile $NetworkProfile `
        -Out $outFile `
        -Seed $Seed `
        -ComposeFile $ComposeFile

    if (Test-Path $outFile) {
        Assert-ObservedProto -SummaryPath $outFile -ProtoName $ProtoName
    }
}

$protocols = @()
if ($Proto -in @('all', 'h3')) { $protocols += 'h3' }
if ($Proto -in @('all', 'h2')) { $protocols += 'h2' }
if ($Proto -in @('all', 'h1')) { $protocols += 'h1' }

$totalRuns = $protocols.Count * $Profiles.Count * $reps
$secondsPerRun = $Ramp + $Duration + 5
$estimateMin = [math]::Round(($totalRuns * $secondsPerRun) / 60, 1)

Write-Host '=== Benchmark rede degradada (R06) ==='
Write-Host "REPS=$reps ($RepsMode) | PROTO=$Proto | LOAD=$Load | SEED=$Seed"
Write-Host "Campanha: $resultsDir"
Write-Host "Gerador: h2load | -c = load | -m 1 | -t 1 | -D ${Duration}s | warm-up ${Ramp}s"
if (-not $NoPause -and $reps -gt 1) {
    Write-Host 'Pausa entre réplicas: ativa (use -NoPause para execução contínua)'
}
Write-Host "Perfis: $($Profiles -join ', ')"
Write-Host "Total de runs: $totalRuns | estimativa: ~${estimateMin} min"
Write-Host ''
Write-Host 'Pre-requisito: docker compose -f docker-compose.bench.yml up --build -d'
Write-Host ''

Assert-Command -Name 'bash'
Assert-Command -Name 'docker'

Write-Host 'Construindo imagem h2load (usa cache se a imagem já existir)...'
& docker compose -f (Join-Path $repoRoot $ComposeFile) --profile load build h2load
if ($LASTEXITCODE -ne 0) {
    throw 'build da imagem h2load falhou'
}

foreach ($profile in $Profiles) {
    Write-Host "===== Perfil de rede: $profile ====="
    try {
        Invoke-Netem -Script $applyScript -ProfileArg $profile

        for ($rep = 1; $rep -le $reps; $rep++) {
            Write-Host "--- $profile | Replica $rep / $reps ---"

            foreach ($protoName in $protocols) {
                Invoke-H2LoadPing -ProtoName $protoName -Rep $rep -NetworkProfile $profile
            }

            Wait-ForNextReplica -CompletedRep $rep -TotalReps $reps -NoPause:$NoPause -CooldownSec $CooldownSec
        }
    }
    finally {
        # Sempre remove o impairment antes do proximo perfil, mesmo em erro.
        Invoke-Netem -Script $clearScript
    }
}

Write-Host ''
Write-Host "Benchmarks de rede degradada concluidos. Campanha: $resultsDir"
Write-Host "Agregue com: npm run bench:agg -- $resultsDir"
