param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('ping', 'payload', 'echo')]
    [string]$Endpoint,

    [int]$Load = 50,
    [int]$Duration = 60,
    [int]$Rep = 1,
    [string]$Size = '1kb',
    [int]$BodyBytes = 102400,
    [string]$Out,
    [string]$Seed = '',
    [string]$NetworkProfile = 'clean',
    [string]$BaseUrl = 'https://host.docker.internal:8443',
    [string]$ImageName = 'http3-bench-client'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$http3Dir = Join-Path $repoRoot 'benchmarks\http3'
$resultsDir = Join-Path $repoRoot 'benchmarks\results'

if (-not $Out) {
    $Out = Join-Path $resultsDir "h3_${Endpoint}_${Load}_${NetworkProfile}_r$($Rep.ToString('00')).json"
}

New-Item -ItemType Directory -Force -Path (Split-Path $Out) | Out-Null

function Get-TargetUrl {
    param([string]$Ep, [string]$Sz, [string]$Base)
    switch ($Ep) {
        'ping' { return "$Base/bench/ping" }
        'payload' { return "$Base/bench/payload/$Sz" }
        'echo' { return "$Base/bench/echo" }
        default { throw "Unknown endpoint: $Ep" }
    }
}

$targetUrl = Get-TargetUrl -Ep $Endpoint -Sz $Size -Base $BaseUrl
$method = if ($Endpoint -eq 'echo') { 'POST' } else { 'GET' }
$bodyFile = ''

if ($Endpoint -eq 'echo') {
    $bodyFile = Join-Path $env:TEMP "h3-echo-$BodyBytes.bin"
    $bytes = New-Object byte[] $BodyBytes
    [System.IO.File]::WriteAllBytes($bodyFile, $bytes)
}

Write-Host "[h3] Building client image (if needed)..."
docker build -t $ImageName -f (Join-Path $http3Dir 'Dockerfile') $repoRoot | Out-Host

$dockerArgs = @(
    'run', '--rm',
    '--add-host=host.docker.internal:host-gateway',
    '-v', "${http3Dir}:/bench:ro"
)

if ($bodyFile) {
    # /bench is mounted :ro; body file must use a path outside that mount.
    $dockerArgs += '-v', "${bodyFile}:/tmp/h3-echo-body.bin:ro"
    $bodyMount = '/tmp/h3-echo-body.bin'
} else {
    $bodyMount = ''
}

$dockerArgs += $ImageName, $targetUrl, "$Load", "$Duration", $method
if ($bodyMount) {
    $dockerArgs += $bodyMount
}

Write-Host "[h3] $Endpoint load=$Load duration=${Duration}s rep=$Rep -> $targetUrl"
$raw = & docker @dockerArgs
if ($LASTEXITCODE -ne 0) {
    throw "HTTP/3 load test failed: $raw"
}

$metrics = $raw | ConvertFrom-Json
$timestamp = (Get-Date).ToUniversalTime().ToString('o')

$summary = [ordered]@{
    tags = [ordered]@{
        proto    = 'h3'
        endpoint = if ($Endpoint -eq 'payload') { "payload_$Size" } else { $Endpoint }
        load     = $Load
        rep      = $Rep
        seed     = $Seed
        network_profile = $NetworkProfile
        timestamp = $timestamp
        tool     = 'curl-http3-docker'
    }
    metrics = $metrics
}

$summary | ConvertTo-Json -Depth 6 | Set-Content -Path $Out -Encoding utf8
Write-Host "[h3] Wrote $Out"

if ($bodyFile -and (Test-Path $bodyFile)) {
    Remove-Item -Force $bodyFile
}

return $Out
