#Requires -Version 7.0
param(
    [ValidateSet('dotnet', 'python', 'nodejs')]
    [string[]]$Stack = @('dotnet', 'python', 'nodejs')
)

$ErrorActionPreference = 'Stop'

function ConvertTo-Base64Url([byte[]]$Bytes) {
    [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function New-CallerToken([string]$Key, [hashtable]$Changes = @{}, [string[]]$Remove = @()) {
    $claims = @{
        iss = 'https://supply-chain.local'
        aud = '22222222-2222-4222-8222-222222222222'
        tid = '11111111-1111-4111-8111-111111111111'
        azp = '33333333-3333-4333-8333-333333333333'
        idtyp = 'app'
        roles = @('Shipment.Invoke')
        nbf = [DateTimeOffset]::UtcNow.AddSeconds(-5).ToUnixTimeSeconds()
        exp = [DateTimeOffset]::UtcNow.AddMinutes(30).ToUnixTimeSeconds()
    }
    foreach ($name in $Changes.Keys) { $claims[$name] = $Changes[$name] }
    foreach ($name in $Remove) { $claims.Remove($name) }
    $header = ConvertTo-Base64Url ([Text.Encoding]::UTF8.GetBytes('{"alg":"HS256","typ":"JWT"}'))
    $payload = ConvertTo-Base64Url ([Text.Encoding]::UTF8.GetBytes(($claims | ConvertTo-Json -Compress)))
    $hmac = [Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($Key))
    try {
        $signature = ConvertTo-Base64Url ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes("$header.$payload")))
        "$header.$payload.$signature"
    } finally {
        $hmac.Dispose()
    }
}

function Send-Event([Net.Http.HttpClient]$Client, [string]$BaseUri, [string]$Token,
    [int]$ExpectedStatus, [string]$Body, [string]$Correlation = 'parity-request', [string]$ExpectedError = '') {
    $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, "$BaseUri/api/shipments")
    if ($Token) { $request.Headers.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $Token) }
    $request.Headers.Add('X-Correlation-ID', $Correlation)
    $request.Content = [Net.Http.StringContent]::new($Body, [Text.Encoding]::UTF8, 'application/json')
    try {
        $response = $Client.SendAsync($request).GetAwaiter().GetResult()
        try {
            $text = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            if ([int]$response.StatusCode -ne $ExpectedStatus) {
                throw "Expected HTTP $ExpectedStatus, got $([int]$response.StatusCode)."
            }
            if (-not $response.Headers.Contains('X-Correlation-ID')) { throw 'Missing correlation response header.' }
            if ($Correlation -eq 'parity-request' -and
                ($response.Headers.GetValues('X-Correlation-ID') -join '') -ne $Correlation) {
                throw 'Correlation response header changed.'
            }
            $result = if ($text) { $text | ConvertFrom-Json } else { $null }
            if ($ExpectedError -and $result.error -ne $ExpectedError) {
                throw "Expected error '$ExpectedError', got '$($result.error)'."
            }
            $result
        } finally {
            $response.Dispose()
        }
    } finally {
        $request.Dispose()
    }
}

foreach ($runtime in $Stack) {
    $folder = Join-Path $PSScriptRoot $runtime
    $key = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
    $portProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $portProbe.Start()
    $port = $portProbe.LocalEndpoint.Port
    $portProbe.Stop()
    $baseUri = "http://127.0.0.1:$port"
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.WorkingDirectory = $folder
    $start.UseShellExecute = $false
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    switch ($runtime) {
        dotnet {
            $assembly = Join-Path $folder 'bin\Debug\net10.0\SupplyChainAgent.dll'
            if (-not (Test-Path $assembly)) { throw 'Build the .NET starting point before running parity checks.' }
            $start.FileName = 'dotnet'
            $start.ArgumentList.Add($assembly)
            $settings = @{
                ASPNETCORE_ENVIRONMENT = 'Development'; DOTNET_ENVIRONMENT = 'Development'
                ASPNETCORE_URLS = $baseUri
                Ingress__Mode = 'Local'; Ingress__LocalSigningKey = $key
                Ingress__TenantId = '11111111-1111-4111-8111-111111111111'
                Ingress__Audience = '22222222-2222-4222-8222-222222222222'
                Ingress__RequiredRole = 'Shipment.Invoke'
                'Ingress__AllowedCallers__33333333-3333-4333-8333-333333333333' = 'Local SAP middleware'
                Agent__ReasoningMode = 'Stub'; Agent__MaxRememberedEvents = '402'
            }
        }
        python {
            $start.FileName = Join-Path $folder '.venv\Scripts\python.exe'
            if (-not (Test-Path $start.FileName)) { throw 'Run uv sync in the Python starting point before parity checks.' }
            $start.ArgumentList.Add('-m')
            $start.ArgumentList.Add('app')
        }
        nodejs {
            if (-not (Test-Path (Join-Path $folder 'node_modules\tsx'))) {
                throw 'Run npm ci in the Node.js starting point before parity checks.'
            }
            $start.FileName = 'node'
            $start.ArgumentList.Add('--import')
            $start.ArgumentList.Add('tsx')
            $start.ArgumentList.Add('src\main.ts')
        }
    }
    if ($runtime -ne 'dotnet') {
        $settings = @{
            APP_ENVIRONMENT = 'Development'; HOST = '127.0.0.1'; PORT = "$port"
            INGRESS_MODE = 'Local'; INGRESS_LOCAL_SIGNING_KEY = $key
            INGRESS_TENANT_ID = '11111111-1111-4111-8111-111111111111'
            INGRESS_AUDIENCE = '22222222-2222-4222-8222-222222222222'
            INGRESS_REQUIRED_ROLE = 'Shipment.Invoke'
            INGRESS_ALLOWED_CALLERS = '{"33333333-3333-4333-8333-333333333333":"Local SAP middleware"}'
            AGENT_REASONING_MODE = 'Stub'; AGENT_MAX_REMEMBERED_EVENTS = '402'
        }
    }
    foreach ($name in $settings.Keys) { $start.Environment[$name] = $settings[$name] }
    $process = $null
    $client = [Net.Http.HttpClient]::new()
    try {
        $process = [Diagnostics.Process]::Start($start)
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $ready = $false
        for ($attempt = 0; $attempt -lt 150; $attempt++) {
            if ($process.HasExited) { throw "$runtime host exited: $($stderr.GetAwaiter().GetResult())" }
            try {
                $response = $client.GetAsync("$baseUri/health").GetAwaiter().GetResult()
                try {
                    $health = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
                    $ready = $response.IsSuccessStatusCode -and $health.status -eq 'ok'
                } finally { $response.Dispose() }
            } catch [Net.Http.HttpRequestException] {
                # The listener can refuse connections while its process starts.
            }
            if ($ready) { break }
            Start-Sleep -Milliseconds 100
        }
        if (-not $ready) { throw "$runtime host did not become ready." }
        $token = New-CallerToken $key
        $body = '{"sourceEventId":"shared-contract","orderId":"ORDER-1","delayHours":12}'
        $call = @{ Client = $client; BaseUri = $baseUri; Body = $body }
        $null = Send-Event @call -Token '' -ExpectedStatus 401 -ExpectedError missing_token
        $null = Send-Event @call -Token 'invalid-token' -ExpectedStatus 401 -ExpectedError invalid_token
        $null = Send-Event @call -Token (New-CallerToken ('x' * 48)) -ExpectedStatus 401
        foreach ($changes in @(
            @{ aud = 'wrong-api' }, @{ iss = 'https://invalid.example' },
            @{ exp = [DateTimeOffset]::UtcNow.AddMinutes(-5).ToUnixTimeSeconds(); nbf = 1 }
        )) {
            $null = Send-Event @call -Token (New-CallerToken $key $changes) -ExpectedStatus 401
        }
        foreach ($claim in @('scp', 'upn', 'preferred_username', 'unique_name')) {
            $null = Send-Event @call -Token (New-CallerToken $key @{ $claim = 'untrusted' }) `
                -ExpectedStatus 403 -ExpectedError app_only_required
        }
        $null = Send-Event @call -Token (New-CallerToken $key -Remove idtyp) -ExpectedStatus 403 -ExpectedError app_only_required
        $null = Send-Event @call -Token (New-CallerToken $key -Remove roles) -ExpectedStatus 403 -ExpectedError missing_role
        $null = Send-Event @call -Token (New-CallerToken $key @{ tid = '44444444-4444-4444-8444-444444444444' }) `
            -ExpectedStatus 403 -ExpectedError wrong_tenant
        $null = Send-Event @call -Token (New-CallerToken $key @{ azp = '44444444-4444-4444-8444-444444444444' }) `
            -ExpectedStatus 403 -ExpectedError caller_not_allowed
        $null = Send-Event @call -Token $token -ExpectedStatus 400 -Correlation 'invalid correlation' -ExpectedError invalid_correlation_id
        foreach ($invalidBody in @('{', 'null', '[]',
            '{"sourceEventId":"","orderId":"ORDER-1","delayHours":12}',
            '{"sourceEventId":"bad","orderId":"ORDER-1","delayHours":true}',
            '{"sourceEventId":"bad","orderId":"ORDER-1","delayHours":1.5}',
            '{"sourceEventId":"bad","orderId":"ORDER-1","delayHours":721}')) {
            $null = Send-Event $client $baseUri $token 400 $invalidBody
        }
        $null = Send-Event $client $baseUri $token 413 ('{"padding":"' + ('x' * 17000) + '"}')
        $first = Send-Event @call -Token $token -ExpectedStatus 200
        $expectedKeys = 'correlationId,notificationId,reasoningMode,runId,sourceEventId,summary,ticketId'
        if (($first.result.PSObject.Properties.Name | Sort-Object) -join ',' -ne $expectedKeys) {
            throw "$runtime returned a different result shape."
        }
        $summary = 'Local simulation: order ORDER-1 is delayed by 12 hours. Bergamo has 50 units of WIDGET-42; the order needs 20. Ask the operations team to assess an alternative shipment. No shipment has been changed.'
        if ($first.replayed -or $first.result.reasoningMode -ne 'Stub' -or $first.result.summary -ne $summary -or
            $first.result.sourceEventId -ne 'shared-contract' -or $first.result.correlationId -ne 'parity-request' -or
            $first.result.notificationId -ne "stub-notification-$($first.result.runId)" -or
            $first.result.ticketId -ne "stub-ticket-$($first.result.runId)") {
            throw "$runtime result differs from the shared stub contract."
        }
        $second = Send-Event @call -Token $token -ExpectedStatus 200 -Correlation 'retry-correlation'
        if (-not $second.replayed -or
            ($second.result | ConvertTo-Json -Compress) -ne ($first.result | ConvertTo-Json -Compress)) {
            throw "$runtime did not replay the original result."
        }
        $null = Send-Event $client $baseUri $token 409 `
            '{"sourceEventId":"shared-contract","orderId":"ORDER-2","delayHours":12}' -ExpectedError payload_conflict
        $previousToken = $env:S2S_CALLER_TOKEN
        try {
            $env:S2S_CALLER_TOKEN = $token
            $harness = Join-Path $PSScriptRoot 'dotnet\Invoke-Replay.ps1'
            $batch = & $harness -BaseUri $baseUri -Count 400 -BatchId shared-batch
            $replay = & $harness -BaseUri $baseUri -Count 400 -BatchId shared-batch
            if ($batch.NewRuns -ne 400 -or $replay.Replays -ne 400 -or $replay.NewRuns -ne 0) {
                throw "$runtime did not produce 400 new runs followed by 400 replays."
            }
        } finally {
            $env:S2S_CALLER_TOKEN = $previousToken
        }
        $pending = @()
        try {
            for ($i = 0; $i -lt 12; $i++) {
                $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, "$baseUri/api/shipments")
                $request.Headers.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $token)
                $request.Content = [Net.Http.StringContent]::new(
                    '{"sourceEventId":"concurrent","orderId":"ORDER-2","delayHours":12}', [Text.Encoding]::UTF8, 'application/json')
                $pending += @{ Request = $request; Task = $client.SendAsync($request) }
            }
            $newRuns = 0
            foreach ($item in $pending) {
                $response = $item.Task.GetAwaiter().GetResult()
                try {
                    $result = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
                    if ([int]$response.StatusCode -eq 200) {
                        if (-not $result.replayed) { $newRuns++ }
                    } elseif ([int]$response.StatusCode -ne 409 -or $result.error -ne 'in_progress') {
                        throw "$runtime returned an unexpected concurrent replay result."
                    }
                } finally { $response.Dispose() }
            }
            if ($newRuns -ne 1) { throw "$runtime executed concurrent duplicates $newRuns times." }
        } finally {
            foreach ($item in $pending) { $item.Request.Dispose() }
        }
        $null = Send-Event $client $baseUri $token 503 `
            '{"sourceEventId":"over-capacity","orderId":"ORDER-3","delayHours":12}' -ExpectedError capacity_reached
        $atCapacity = Send-Event @call -Token $token -ExpectedStatus 200
        if (-not $atCapacity.replayed) { throw "$runtime lost completed replays at capacity." }
        Write-Output "$runtime passed the shared HTTP contract, including 400 runs, 400 replays and concurrent reservations."
    } finally {
        $client.Dispose()
        if ($process) {
            if (-not $process.HasExited) { $process.Kill($true) }
            $process.WaitForExit()
            $process.Dispose()
        }
    }
}
