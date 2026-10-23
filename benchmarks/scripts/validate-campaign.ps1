# Valida qualidade minima de uma campanha ideal antes de reportar no TCC.
param(
    [Parameter(Mandatory = $true)]
    [string]$CampaignDir
)

$ErrorActionPreference = 'Stop'
$files = @(Get-ChildItem $CampaignDir -Filter '*_r*.json')
if ($files.Count -lt 210) {
    throw "Esperado 210 JSON; encontrado $($files.Count)"
}

$bad = @()
foreach ($f in $files) {
    $j = Get-Content $f.FullName -Raw | ConvertFrom-Json
    $proto = $j.tags.proto
    $ep = $j.tags.endpoint
    $m = $j.metrics
    if ($proto -in @('h1', 'h2')) {
        if ($m.http_req_failed_rate -gt 0.1) {
            $bad += "$($f.Name): failed_rate=$($m.http_req_failed_rate)"
        }
        if (-not $m.http_req_duration_p95 -or $m.http_req_duration_p95 -le 0) {
            $bad += "$($f.Name): p95=$($m.http_req_duration_p95)"
        }
    }
    if ($proto -eq 'h3') {
        if ($m.http_req_failed_rate -gt 0.1) {
            $bad += "$($f.Name): h3 failed_rate=$($m.http_req_failed_rate)"
        }
        if ($m.http_req_duration_p95 -gt 60000) {
            $bad += "$($f.Name): h3 p95 suspeito (timeout?) $($m.http_req_duration_p95)"
        }
    }
}

if ($bad.Count) {
    $bad | ForEach-Object { Write-Host $_ }
    throw "Campanha falhou na validacao ($($bad.Count) problemas)"
}

Write-Host "Campanha OK: $($files.Count) runs validados."
