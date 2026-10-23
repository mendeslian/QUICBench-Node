# Monitora a campanha ideal (com log e timeout), agrega e escreve o resumo.
param(
    [Parameter(Mandatory = $true)]
    [string]$IdealCampaignDir,
    [int]$TargetJson = 210,
    [int]$PollSec = 180,
    [int]$MaxWaitHours = 7
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$resultsDir = Join-Path $repoRoot 'benchmarks\results'
$logFile = Join-Path $resultsDir 'tcc-pipeline-monitor.log'
$summaryFile = Join-Path $resultsDir 'tcc-campaign-summary.json'

function Log([string]$msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $logFile -Value $line -Encoding utf8
    Write-Host $line
}

function Write-Summary([bool]$success, [string]$err, [int]$count) {
    @{
        success        = $success
        error          = $err
        ideal_campaign = $IdealCampaignDir
        ideal_json     = $count
        completed_at   = (Get-Date).ToUniversalTime().ToString('o')
    } | ConvertTo-Json -Depth 4 | Set-Content $summaryFile -Encoding utf8
}

Log "Monitor start. Ideal=$IdealCampaignDir target=$TargetJson poll=${PollSec}s max=${MaxWaitHours}h"

$deadline = (Get-Date).AddHours($MaxWaitHours)
$idealDone = $false
$idealCount = 0

while ((Get-Date) -lt $deadline) {
    $idealCount = @(Get-ChildItem $IdealCampaignDir -Filter '*_r*.json' -ErrorAction SilentlyContinue).Count
    if ($idealCount -ge $TargetJson) {
        Log "Ideal campaign complete: $idealCount JSON files."
        $idealDone = $true
        break
    }
    Log "Waiting: $idealCount / $TargetJson JSON files..."
    Start-Sleep -Seconds $PollSec
}

if (-not $idealDone) {
    Log "TIMEOUT after $MaxWaitHours h. ideal_json=$idealCount"
    Write-Summary $false 'timeout_waiting_ideal_campaign' $idealCount
    exit 1
}

Set-Location $repoRoot

Log "Aggregating ideal: $IdealCampaignDir"
& npm run bench:agg -- $IdealCampaignDir
if ($LASTEXITCODE -ne 0) { Log "WARN: bench:agg ideal exit $($LASTEXITCODE)" }

Write-Summary $true '' $idealCount
Log 'Pipeline complete. Summary written.'
exit 0
