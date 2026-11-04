param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('h1', 'h2', 'h3')]
    [string]$Proto,

    [Parameter(Mandatory = $true)]
    [ValidateSet('ping', 'payload', 'echo')]
    [string]$Endpoint,

    [string]$EndpointTag = '',

    [int]$Load = 50,
    [int]$Duration = 60,
    [int]$Warmup = 10,
    [int]$Rep = 1,
    [string]$Size = '1kb',
    [int]$BodyBytes = 102400,
    [string]$Out,
    [string]$Seed = '',
    [string]$NetworkProfile = 'clean',
    [string]$ComposeFile = 'docker-compose.bench.yml',
    [string]$BaseUrl = 'https://nginx:8443'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')

if (-not $EndpointTag) {
    $EndpointTag = if ($Endpoint -eq 'payload') { "payload_$Size" } else { $Endpoint }
}

if (-not $Out) {
    $Out = Join-Path $repoRoot "benchmarks\results\${Proto}_${EndpointTag}_${Load}_r$($Rep.ToString('00')).json"
}

New-Item -ItemType Directory -Force -Path (Split-Path $Out) | Out-Null

function Get-TargetUrl {
    param([string]$Ep, [string]$Sz, [string]$Base)
    switch ($Ep) {
        'ping' { return "$Base/bench/ping" }
        'payload' { return "$Base/bench/payload/$Sz" }
        'echo' { return "$Base/bench/echo" }
        default { throw "Endpoint desconhecido: $Ep" }
    }
}

$targetUrl = Get-TargetUrl -Ep $Endpoint -Sz $Size -Base $BaseUrl
$protoFlags = switch ($Proto) {
    'h1' { @('--h1') }
    'h2' { @('--alpn-list=h2') }
    'h3' { @('--h3') }
}

$work = Join-Path $env:TEMP ("h2load-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $work | Out-Null
$bodyFile = ''

if ($Endpoint -eq 'echo') {
    $bodyFile = Join-Path $work 'echo.bin'
    $bytes = New-Object byte[] $BodyBytes
    [System.IO.File]::WriteAllBytes($bodyFile, $bytes)
}

$composePath = Join-Path $repoRoot $ComposeFile
$dockerArgs = @(
    'compose', '-f', $composePath,
    '--profile', 'load',
    'run', '--rm', '--no-deps',
    '-v', "${work}:/out"
)

if ($bodyFile) {
    $dockerArgs += @('-v', "${bodyFile}:/tmp/echo.bin:ro")
}

$dockerArgs += @(
    'h2load',
    '-c', "$Load",
    '-m', '1',
    '-t', '1',
    '-D', "${Duration}s"
)

if ($Warmup -gt 0) {
    $dockerArgs += "--warm-up-time=${Warmup}s"
}

$dockerArgs += @('--output-file=/out/raw.json')
$dockerArgs += $protoFlags

if ($bodyFile) {
    $dockerArgs += @('-d', '/tmp/echo.bin', '-H', 'content-type: application/octet-stream')
}

$dockerArgs += $targetUrl

Write-Host "[h2load] $Proto $EndpointTag load=$Load duration=${Duration}s warmup=${Warmup}s rep=$Rep -> $targetUrl"

Push-Location $repoRoot
try {
    & docker @dockerArgs
    if ($LASTEXITCODE -ne 0) {
        throw "h2load falhou (exit $LASTEXITCODE): $Proto $EndpointTag rep=$Rep"
    }

    $raw = Join-Path $work 'raw.json'
    if (-not (Test-Path $raw)) {
        throw "h2load não gravou $raw"
    }

    & npx --no-install tsx ./benchmarks/h2load/map-summary.ts `
        --raw $raw `
        --out $Out `
        --proto $Proto `
        --endpoint $EndpointTag `
        --load "$Load" `
        --rep "$Rep" `
        --seed="$Seed" `
        --network-profile="$NetworkProfile"
    if ($LASTEXITCODE -ne 0) {
        throw "conversor do JSON do h2load falhou: $Out"
    }

    $written = Get-Content -Raw -Path $Out | ConvertFrom-Json
    if ($written.metrics.http_reqs_count -eq 0) {
        throw "h2load gravou 0 requisições em $Out"
    }
}
finally {
    Pop-Location
    if (Test-Path $work) {
        Remove-Item -Recurse -Force $work
    }
}

Write-Host "[h2load] Wrote $Out"
return $Out
