# Funções compartilhadas: pasta de campanha datada, manifesto e pausa entre réplicas.

function New-CampaignResultsDir {
    param([string]$RepoRoot)

    $stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
    $campaignDir = Join-Path $RepoRoot "benchmarks\results\$stamp"
    New-Item -ItemType Directory -Force -Path $campaignDir | Out-Null
    return $campaignDir
}

function Write-CampaignManifest {
    param(
        [string]$CampaignDir,
        [hashtable]$Metadata
    )

    $path = Join-Path $CampaignDir 'campaign.json'
    $Metadata | ConvertTo-Json -Depth 6 | Set-Content -Path $path -Encoding utf8
    return $path
}

function Wait-ForNextReplica {
    param(
        [int]$CompletedRep,
        [int]$TotalReps,
        [bool]$NoPause,
        [int]$CooldownSec = 600
    )

    if ($NoPause) { return }
    if ($CompletedRep -ge $TotalReps) { return }

    $next = $CompletedRep + 1
    if ($CooldownSec -gt 0) {
        Write-Host ''
        Write-Host "Réplica $CompletedRep/$TotalReps concluída. Resfriamento ${CooldownSec}s antes da réplica $next/$TotalReps..."
        Start-Sleep -Seconds $CooldownSec
        Write-Host ''
        return
    }

    Write-Host ''
    Read-Host "Réplica $CompletedRep/$TotalReps concluída. Pressione Enter para iniciar a réplica $next/$TotalReps (resfriamento)."
    Write-Host ''
}

function Assert-ObservedProto {
    param(
        [string]$SummaryPath,
        [string]$ProtoName
    )

    $expected = @{
        h1 = 'HTTP/1.1'
        h2 = 'HTTP/2.0'
        h3 = 'HTTP/3'
    }[$ProtoName]

    if (-not $expected) {
        return
    }

    if (-not (Test-Path $SummaryPath)) {
        throw "Summary ausente para checar observed_proto ($ProtoName): $SummaryPath"
    }

    $summary = Get-Content -Raw -Path $SummaryPath | ConvertFrom-Json
    $actual = [string]$summary.metrics.observed_proto
    if ($actual -ne $expected) {
        throw "observed_proto=$actual em $SummaryPath; esperado $expected para PROTO=$ProtoName"
    }
}
