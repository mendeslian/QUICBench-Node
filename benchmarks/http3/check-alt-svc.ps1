param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('discover', 'fallback', 'restore-check')]
    [string]$Phase,

    [string]$OutDir,
    [string]$Project = 'quicbench-host',
    [string]$ComposeFile = 'docker-compose.yml'
)

$ErrorActionPreference = 'Stop'
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $repoRoot

if (-not $OutDir) {
    if ($Phase -ne 'discover') {
        throw 'OutDir é obrigatório fora da fase discover'
    }
    $stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
    $OutDir = Join-Path $repoRoot "benchmarks\results\alt-svc-fallback\$stamp"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path

$commandsPath = Join-Path $OutDir 'commands.txt'
$image = 'alpine/curl-http3'
$url = 'https://host.docker.internal:8443/bench/ping'

function Add-Command {
    param([string]$Text)
    Add-Content -Path $commandsPath -Value $Text -Encoding utf8
}

function Save-ComposePs {
    $dest = Join-Path $OutDir "compose-ps-$Phase.txt"
    docker compose -p $Project -f $ComposeFile ps --all *> $dest
    Add-Command "docker compose -p $Project -f $ComposeFile ps --all"
}

function Save-NginxSince {
    param([string]$Since, [string]$DestName)
    $dest = Join-Path $OutDir $DestName
    docker compose -p $Project -f $ComposeFile logs --no-color --timestamps --since $Since nginx *> $dest
    Add-Command "docker compose -p $Project -f $ComposeFile logs --no-color --timestamps --since $Since nginx"
}

function Invoke-CurlInImage {
    param([string]$Tag, [string]$CurlTail)
    $since = (Get-Date).AddSeconds(-3).ToString('yyyy-MM-ddTHH:mm:ssK')
    Set-Content -Path (Join-Path $OutDir "since-$Tag.txt") -Value $since -Encoding utf8 -NoNewline
    $shell = "curl -k --connect-timeout 15 --max-time 30 $CurlTail -D /out/headers-$Tag.txt -o /out/body-$Tag.txt -w 'http_version=%{http_version}\nhttp_code=%{http_code}\n' -v $url > /out/writeout-$Tag.txt 2> /out/verbose-$Tag.txt; ec=`$?; echo `$ec > /out/exit-$Tag.txt; exit `$ec"
    Add-Command $shell
    docker run --rm --add-host=host.docker.internal:host-gateway -v "${OutDir}:/out" --entrypoint sh $image -c $shell
    $dockerExit = $LASTEXITCODE
    Set-Content -Path (Join-Path $OutDir "docker-exit-$Tag.txt") -Value "$dockerExit" -Encoding utf8 -NoNewline
    $cache = Join-Path $OutDir 'altsvc.txt'
    $cacheCopy = Join-Path $OutDir "altsvc-after-$Tag.txt"
    if (Test-Path $cache) {
        Copy-Item $cache $cacheCopy -Force
    } else {
        Set-Content -Path $cacheCopy -Value 'arquivo ausente' -Encoding utf8
    }
    Save-NginxSince -Since $since -DestName "nginx-$Tag.txt"
}

Save-ComposePs

if ($Phase -eq 'discover') {
    $versionPath = Join-Path $OutDir 'curl-version.txt'
    docker run --rm --entrypoint curl $image -V *> $versionPath
    Add-Command "docker run --rm --entrypoint curl $image -V"
    $versionText = Get-Content -Raw -Path $versionPath
    if ($versionText -notmatch 'HTTP3') {
        Set-Content -Path (Join-Path $OutDir 'stopped.txt') -Value 'curl -V nao lista HTTP3' -Encoding utf8
        Write-Output $OutDir
        exit 2
    }
    docker run --rm --add-host=host.docker.internal:host-gateway -v "${OutDir}:/out" --entrypoint sh $image -c ': > /out/altsvc.txt'
    Add-Command 'touch /out/altsvc.txt'
    Invoke-CurlInImage -Tag '1' -CurlTail '--http2 --alt-svc /out/altsvc.txt'
    Invoke-CurlInImage -Tag '2' -CurlTail '--alt-svc /out/altsvc.txt'
}

if ($Phase -eq 'fallback') {
    Invoke-CurlInImage -Tag '3' -CurlTail '--alt-svc /out/altsvc.txt'
}

if ($Phase -eq 'restore-check') {
    Invoke-CurlInImage -Tag 'restore' -CurlTail '--http3-only'
}

Write-Output $OutDir
