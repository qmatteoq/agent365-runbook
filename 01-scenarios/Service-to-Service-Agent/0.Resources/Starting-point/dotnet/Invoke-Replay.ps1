#Requires -Version 7.0
[CmdletBinding()]
param(
    [uri]$BaseUri = 'http://localhost:5168',
    [ValidateRange(1, 10000)][int]$Count = 400,
    [ValidatePattern('^[a-zA-Z0-9_-]{1,32}$')][string]$BatchId = [guid]::NewGuid().ToString('N'),
    [ValidateRange(0, 60000)][int]$DelayMs = 0
)
$ErrorActionPreference = 'Stop'
if (-not $BaseUri.IsAbsoluteUri -or $BaseUri.UserInfo -or $BaseUri.Query -or $BaseUri.Fragment -or
    $BaseUri.AbsolutePath -ne '/' -or
    ($BaseUri.Scheme -ne 'https' -and -not ($BaseUri.Scheme -eq 'http' -and $BaseUri.IsLoopback))) {
    throw 'BaseUri must be an HTTPS origin, or an HTTP loopback origin for local development.'
}
if ([string]::IsNullOrWhiteSpace($env:S2S_CALLER_TOKEN)) {
    throw 'Set S2S_CALLER_TOKEN to a caller access token. Do not put bearer tokens on the command line.'
}
$handler = [System.Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $false
$client = [System.Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromMinutes(2)
$client.DefaultRequestHeaders.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $env:S2S_CALLER_TOKEN.Trim())
$clock = [Diagnostics.Stopwatch]::StartNew()
$accepted = 0
$replayed = 0
$failed = 0
try {
    for ($i = 1; $i -le $Count; $i++) {
        $message = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, [uri]::new($BaseUri, '/api/shipments'))
        $message.Headers.Add('X-Correlation-ID', "$BatchId-$i")
        $message.Content = [System.Net.Http.StringContent]::new(
            (@{ sourceEventId = "$BatchId-$i"; orderId = "ORDER-$i"; delayHours = 12 } | ConvertTo-Json -Compress),
            [Text.Encoding]::UTF8, 'application/json')
        try {
            $response = $client.SendAsync($message).GetAwaiter().GetResult()
            try {
                if ($response.IsSuccessStatusCode) {
                    $result = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
                    if ($result.replayed) { $replayed++ } else { $accepted++ }
                } else {
                    $failed++
                    Write-Warning "Event $i returned HTTP $([int]$response.StatusCode)."
                }
            } finally { $response.Dispose() }
        } finally { $message.Dispose() }
        if ($DelayMs -gt 0) { Start-Sleep -Milliseconds $DelayMs }
    }
} finally { $client.Dispose() }
$clock.Stop()
[pscustomobject]@{
    BatchId = $BatchId
    Attempts = $Count
    NewRuns = $accepted
    Replays = $replayed
    Failed = $failed
    DurationSeconds = [math]::Round($clock.Elapsed.TotalSeconds, 2)
}
if ($failed -gt 0) { throw "$failed invocation attempts failed." }
