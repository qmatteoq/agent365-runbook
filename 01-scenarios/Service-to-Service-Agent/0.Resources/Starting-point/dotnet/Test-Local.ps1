#Requires -Version 7.0
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
$process = $null
$client = $null
$oldToken = $env:S2S_CALLER_TOKEN
try {
    dotnet build --nologo --verbosity quiet
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    $key = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
    $tenant = '11111111-1111-4111-8111-111111111111'
    $audience = '22222222-2222-4222-8222-222222222222'
    $caller = '33333333-3333-4333-8333-333333333333'
    $portProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $portProbe.Start()
    $port = $portProbe.LocalEndpoint.Port
    $portProbe.Stop()
    $baseUri = "http://127.0.0.1:$port"
    $start = [Diagnostics.ProcessStartInfo]::new('dotnet')
    $start.ArgumentList.Add((Join-Path $PSScriptRoot 'bin\Debug\net10.0\SupplyChainAgent.dll'))
    $start.WorkingDirectory = $PSScriptRoot
    $start.UseShellExecute = $false
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.Environment['ASPNETCORE_ENVIRONMENT'] = 'Development'
    $start.Environment['DOTNET_ENVIRONMENT'] = 'Development'
    $start.Environment['ASPNETCORE_URLS'] = $baseUri
    $start.Environment['Ingress__Mode'] = 'Local'
    $start.Environment['Ingress__LocalSigningKey'] = $key
    $start.Environment['Ingress__TenantId'] = $tenant
    $start.Environment['Ingress__Audience'] = $audience
    $start.Environment["Ingress__AllowedCallers__$caller"] = 'Local SAP middleware'
    $start.Environment['Ingress__RequiredRole'] = 'Shipment.Invoke'
    $start.Environment['Agent__ReasoningMode'] = 'Stub'
    $start.Environment['Agent__MaxRememberedEvents'] = '402'
    $process = [Diagnostics.Process]::Start($start)
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    $client = [Net.Http.HttpClient]::new()
    $ready = $false
    for ($attempt = 0; $attempt -lt 100; $attempt++) {
        if ($process.HasExited) { throw "Host exited: $($stderr.GetAwaiter().GetResult())" }
        try {
            $response = $client.GetAsync("$baseUri/health").GetAwaiter().GetResult()
            $ready = $response.IsSuccessStatusCode
            $response.Dispose()
        } catch [Net.Http.HttpRequestException] {
            # A refused connection is expected while Kestrel starts.
        }
        if ($ready) { break }
        Start-Sleep -Milliseconds 100
    }
    if (-not $ready) { throw 'Host did not become ready.' }

    function Encode-Base64Url([byte[]]$bytes) {
        return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    }
    function New-Token([hashtable]$Changes = @{}, [string[]]$Remove = @(), [string]$SigningKey = $key) {
        $claims = @{
            iss = 'https://supply-chain.local'; aud = $audience; tid = $tenant
            azp = $caller; idtyp = 'app'; roles = @('Shipment.Invoke')
            nbf = [DateTimeOffset]::UtcNow.AddSeconds(-5).ToUnixTimeSeconds()
            exp = [DateTimeOffset]::UtcNow.AddMinutes(30).ToUnixTimeSeconds()
        }
        foreach ($name in $Changes.Keys) { $claims[$name] = $Changes[$name] }
        foreach ($name in $Remove) { $claims.Remove($name) }
        $header = Encode-Base64Url ([Text.Encoding]::UTF8.GetBytes('{"alg":"HS256","typ":"JWT"}'))
        $payload = Encode-Base64Url ([Text.Encoding]::UTF8.GetBytes(($claims | ConvertTo-Json -Compress)))
        $hmac = [Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($SigningKey))
        try { $signature = Encode-Base64Url ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes("$header.$payload"))) }
        finally { $hmac.Dispose() }
        return "$header.$payload.$signature"
    }
    function Send-Event([string]$Token, [int]$Expected, [string]$Body = '{"sourceEventId":"smoke-1","orderId":"ORDER-1","delayHours":12}', [string]$Correlation = '') {
        $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, "$baseUri/api/shipments")
        if ($Token) { $request.Headers.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $Token) }
        if ($Correlation) { $request.Headers.Add('X-Correlation-ID', $Correlation) }
        $request.Content = [Net.Http.StringContent]::new($Body, [Text.Encoding]::UTF8, 'application/json')
        try {
            $response = $client.SendAsync($request).GetAwaiter().GetResult()
            try {
                $text = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                if ([int]$response.StatusCode -ne $Expected) { throw "Expected HTTP $Expected, got $([int]$response.StatusCode): $text" }
                if (-not $response.Headers.Contains('X-Correlation-ID')) { throw 'Missing correlation response header.' }
                return $text | ConvertFrom-Json
            } finally { $response.Dispose() }
        } finally { $request.Dispose() }
    }

    function Invoke-TokenCommand {
        $issuer = [Diagnostics.Process]::Start($start)
        try {
            $output = $issuer.StandardOutput.ReadToEndAsync()
            $errors = $issuer.StandardError.ReadToEndAsync()
            $issuer.WaitForExit()
            return @{
                ExitCode = $issuer.ExitCode
                Output = $output.GetAwaiter().GetResult().Trim()
                Errors = $errors.GetAwaiter().GetResult()
            }
        } finally { $issuer.Dispose() }
    }
    $start.ArgumentList.Add('--issue-local-token')
    $issued = Invoke-TokenCommand
    if ($issued.ExitCode -ne 0) { throw "Local token command failed: $($issued.Errors)" }
    $validToken = $issued.Output
    $start.Environment['ASPNETCORE_ENVIRONMENT'] = 'Production'
    $start.Environment['DOTNET_ENVIRONMENT'] = 'Production'
    $refused = Invoke-TokenCommand
    if ($refused.ExitCode -eq 0 -or $refused.Errors -notmatch 'Local authentication is allowed only in Development') {
        throw 'Production did not reject local authentication.'
    }
    $start.Environment['Ingress__Mode'] = 'Entra'
    $refused = Invoke-TokenCommand
    if ($refused.ExitCode -eq 0 -or $refused.Errors -notmatch 'Local tokens cannot be issued in Entra mode') {
        throw 'Entra mode did not reject local token issuance.'
    }
    $null = Send-Event '' 401
    $null = Send-Event 'not-a-jwt' 401
    $null = Send-Event (New-Token -SigningKey ('x' * 48)) 401
    $null = Send-Event (New-Token @{ aud = 'other-api' }) 401
    $null = Send-Event (New-Token @{ iss = 'https://untrusted.example' }) 401
    $null = Send-Event (New-Token @{ exp = [DateTimeOffset]::UtcNow.AddMinutes(-5).ToUnixTimeSeconds(); nbf = 1 }) 401
    $null = Send-Event (New-Token @{ tid = '44444444-4444-4444-8444-444444444444' }) 403
    $null = Send-Event (New-Token @{ azp = '44444444-4444-4444-8444-444444444444' }) 403
    $null = Send-Event (New-Token -Remove @('roles')) 403
    $null = Send-Event (New-Token @{ scp = 'Shipment.Invoke' }) 403
    $null = Send-Event (New-Token @{ upn = 'person@example.invalid' }) 403
    $null = Send-Event (New-Token -Remove @('idtyp')) 403
    $null = Send-Event $validToken 400 -Correlation 'invalid correlation'
    $null = Send-Event $validToken 400 -Body '{"sourceEventId":"","orderId":"ORDER-1","delayHours":0}'
    $null = Send-Event $validToken 400 -Body '{'
    $null = Send-Event $validToken 400 -Body 'null'
    $null = Send-Event $validToken 413 -Body ('{"padding":"' + ('x' * 17000) + '"}')
    $first = Send-Event $validToken 200 -Correlation 'supplied-correlation'
    if ($first.replayed -or $first.result.correlationId -ne 'supplied-correlation') { throw 'First-run attribution failed.' }
    $second = Send-Event $validToken 200
    if (-not $second.replayed -or $second.result.runId -ne $first.result.runId) { throw 'Duplicate ran again.' }
    $null = Send-Event $validToken 409 -Body '{"sourceEventId":"smoke-1","orderId":"ORDER-2","delayHours":12}'
    $env:S2S_CALLER_TOKEN = $validToken
    $batch = [guid]::NewGuid().ToString('N')
    $replay = & (Join-Path $PSScriptRoot 'Invoke-Replay.ps1') -BaseUri $baseUri -BatchId $batch
    if ($replay.NewRuns -ne 400) { throw 'Expected 400 new runs.' }
    $duplicates = & (Join-Path $PSScriptRoot 'Invoke-Replay.ps1') -BaseUri $baseUri -BatchId $batch
    if ($duplicates.Replays -ne 400 -or $duplicates.NewRuns -ne 0) { throw 'Replay was not idempotent.' }
    $pending = @()
    try {
        for ($i = 0; $i -lt 12; $i++) {
            $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, "$baseUri/api/shipments")
            $request.Headers.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $validToken)
            $request.Content = [Net.Http.StringContent]::new(
                '{"sourceEventId":"concurrent","orderId":"ORDER-2","delayHours":12}', [Text.Encoding]::UTF8, 'application/json')
            $pending += @{ Request = $request; Task = $client.SendAsync($request) }
        }
        $newRuns = 0
        foreach ($item in $pending) {
            $response = $item.Task.GetAwaiter().GetResult()
            try {
                $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
                if ([int]$response.StatusCode -eq 200) {
                    if (-not $body.replayed) { $newRuns++ }
                } elseif ([int]$response.StatusCode -ne 409 -or $body.error -ne 'in_progress') {
                    throw "Concurrent duplicate returned unexpected HTTP $([int]$response.StatusCode)."
                }
            } finally { $response.Dispose() }
        }
        if ($newRuns -ne 1) { throw "Concurrent duplicates created $newRuns runs." }
    } finally { foreach ($item in $pending) { $item.Request.Dispose() } }
    $null = Send-Event $validToken 503 -Body '{"sourceEventId":"over-capacity","orderId":"ORDER-3","delayHours":12}'
    $replayedAtCapacity = Send-Event $validToken 200
    if (-not $replayedAtCapacity.replayed) { throw 'Completed replay failed at capacity.' }
    Write-Output 'Local checks passed: JWT validation, app-only policy, correlation, input limits, concurrency, ledger capacity, 400 runs and 400 replays.'
} finally {
    if ($client) { $client.Dispose() }
    if ($process) {
        if (-not $process.HasExited) { $process.Kill($true) }
        $process.WaitForExit()
        $process.Dispose()
    }
    $env:S2S_CALLER_TOKEN = $oldToken
    Pop-Location
}
