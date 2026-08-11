<#
.SYNOPSIS
    Builds appPackage.zip, the Teams / Microsoft 365 Copilot app package for this agent.

.DESCRIPTION
    This agent reaches Teams the same way any custom engine agent does: through an Azure Bot
    Service registration with the Teams channel enabled, described by a Teams app manifest.

    BOT_ID is the application id of the Azure Bot registration. It is deliberately NOT the
    Agent 365 blueprint id: Entra bars agentic applications from requesting client-credentials
    tokens (AADSTS82001), so a blueprint cannot authenticate outbound Bot Framework replies. A
    plain single-tenant Entra app owns the channel, while the blueprint (added when the agent is
    onboarded to Agent 365) owns governance and observability.

    TEAMS_APP_ID identifies the app in the Teams catalogue. It is unrelated to any Entra identity,
    so it does not have to be supplied: this script generates one on the first build and caches it
    in teams-app-id.local.json (gitignored) so that every later build reuses it. That stability
    matters, because a new id makes Teams treat the upload as a brand new app rather than an
    update to the one you already installed.

    BOT_ID is specific to your tenant, so there is no default. Pass it explicitly or set BOT_ID in
    the environment.

.EXAMPLE
    ./build-app-package.ps1 -BotId <bot-app-id>

.EXAMPLE
    ./build-app-package.ps1 -BotId <bot-app-id> -TeamsAppId <existing-teams-app-id>
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

# Resolve the Teams app id: an explicit value wins, then the cached one from a previous build,
# and only if neither exists do we mint a new id and persist it.
$teamsAppIdFile = Join-Path $PSScriptRoot 'teams-app-id.local.json'
$teamsAppIdOrigin = 'supplied'

if (-not $TeamsAppId -and (Test-Path $teamsAppIdFile)) {
    $TeamsAppId = (Get-Content $teamsAppIdFile -Raw | ConvertFrom-Json).teamsAppId
    $teamsAppIdOrigin = 'reused from teams-app-id.local.json'
}

if (-not $TeamsAppId) {
    $TeamsAppId = [guid]::NewGuid().ToString()
    $teamsAppIdOrigin = 'generated'
}

$parsedTeamsAppId = [guid]::Empty
if (-not [guid]::TryParse($TeamsAppId, [ref]$parsedTeamsAppId)) {
    throw "TeamsAppId '$TeamsAppId' is not a valid GUID."
}
$TeamsAppId = $parsedTeamsAppId.ToString()

if ($teamsAppIdOrigin -ne 'reused from teams-app-id.local.json') {
    @{ teamsAppId = $TeamsAppId } | ConvertTo-Json | Set-Content $teamsAppIdFile -Encoding UTF8
}

$source = Join-Path $PSScriptRoot 'appPackage'
$staging = Join-Path ([System.IO.Path]::GetTempPath()) "learnpyteamsagent-pkg-$([guid]::NewGuid())"

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
    Write-Host "  Teams app id: $TeamsAppId ($teamsAppIdOrigin)"
    Write-Host "  Bot id:       $BotId"
}
finally {
    Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
}
