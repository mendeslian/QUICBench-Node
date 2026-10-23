# Aguarda a campanha ideal terminar, agrega o resultado e escreve o resumo.
param(
    [Parameter(Mandatory = $true)]
    [string]$IdealCampaignDir,

    [int]$Reps = 10
)

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')

$target = $Reps * 21
Write-Host "Aguardando $target JSON em $IdealCampaignDir ..."

while ($true) {
    $n = @(Get-ChildItem $IdealCampaignDir -Filter '*_r*.json' -ErrorAction SilentlyContinue).Count
    if ($n -ge $target) {
        Write-Host "Ideal: $n arquivos - concluida."
        break
    }
    Start-Sleep -Seconds 120
}

Write-Host "Agregando ideal: $IdealCampaignDir"
& npm run bench:agg -- $IdealCampaignDir

$summary = @{
    ideal_campaign = $IdealCampaignDir
    ideal_json     = $n
    completed_at   = (Get-Date).ToUniversalTime().ToString('o')
} | ConvertTo-Json -Depth 4

$summary | Set-Content (Join-Path $repoRoot 'benchmarks\results\tcc-campaign-summary.json') -Encoding utf8
Write-Host "Concluido. Resumo: benchmarks/results/tcc-campaign-summary.json"
