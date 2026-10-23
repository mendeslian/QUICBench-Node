param([string]$CampaignDir)
$repo = Split-Path (Split-Path $PSScriptRoot)
Set-Location $repo
while ((Get-ChildItem $CampaignDir -Filter '*_r*.json' -EA SilentlyContinue).Count -lt 210) {
    Start-Sleep -Seconds 90
}
npm run bench:agg -- $CampaignDir
pwsh -NoProfile -File benchmarks/scripts/validate-campaign.ps1 -CampaignDir $CampaignDir
'OK' | Set-Content (Join-Path $CampaignDir '.validated')
