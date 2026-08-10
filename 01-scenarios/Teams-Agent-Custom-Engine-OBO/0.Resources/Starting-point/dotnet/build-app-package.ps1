<#
.SYNOPSIS
    Builds appPackage.zip, the Teams / Microsoft 365 Copilot app package for this agent.

.DESCRIPTION
    This agent reaches Teams the same way any custom engine agent does: through an Azure Bot
    Service registration with the Teams channel enabled, described by a Teams app manifest.

    BOT_ID is the application id of the Azure Bot registration. Keep it a plain single-tenant
    Entra app. When this agent is later onboarded to Agent 365, do NOT replace this id with the
    blueprint id: Entra bars agentic applications from requesting client-credentials tokens
    (AADSTS82001), so a blueprint cannot authenticate outbound Bot Framework replies. The
    blueprint is added alongside and owns governance, Work IQ tools and observability.

    TEAMS_APP_ID identifies the app in the Teams catalogue. It is unrelated to any Entra identity
    and only has to stay stable across builds, otherwise each upload is treated as a brand new
    app rather than an update. Generate one once with [guid]::NewGuid() and keep it.

    Both values are specific to your tenant, so there are no defaults. Pass them explicitly, or
    set BOT_ID and TEAMS_APP_ID in the environment.

.EXAMPLE
    ./build-app-package.ps1 -BotId <bot-app-id> -TeamsAppId <teams-app-id>
#>
[CmdletBinding()]
param(
    [string]$BotId = $env:BOT_ID,
    [string]$TeamsAppId = $env:TEAMS_APP_ID,
    [string]$OutputPath = "$PSScriptRoot/appPackage.zip"
)

$ErrorActionPreference = 'Stop'

if (-not $BotId) {
    throw "BotId not supplied. Pass -BotId or set the BOT_ID environment variable."
}

if (-not $TeamsAppId) {
    throw "TeamsAppId not supplied. Pass -TeamsAppId or set the TEAMS_APP_ID environment variable."
}

$source = Join-Path $PSScriptRoot 'appPackage'
$staging = Join-Path ([System.IO.Path]::GetTempPath()) "learnteamsagent-pkg-$([guid]::NewGuid())"

New-Item -ItemType Directory -Path $staging -Force | Out-Null

try {
    (Get-Content (Join-Path $source 'manifest.json') -Raw).
        Replace('${{BOT_ID}}', $BotId).
        Replace('${{TEAMS_APP_ID}}', $TeamsAppId) |
        Set-Content (Join-Path $staging 'manifest.json') -Encoding UTF8

    Copy-Item (Join-Path $source 'color.png') $staging
    Copy-Item (Join-Path $source 'outline.png') $staging

    if (Test-Path $OutputPath) { Remove-Item $OutputPath -Force }
    Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $OutputPath

    Write-Host "Built $OutputPath"
    Write-Host "  Teams app id: $TeamsAppId"
    Write-Host "  Bot id:       $BotId"
}
finally {
    Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
}
