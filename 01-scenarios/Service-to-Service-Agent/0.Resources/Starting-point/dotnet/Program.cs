using System.Net;
using Microsoft.AspNetCore.Authentication;
using SupplyChainAgent;

var issueLocalToken = args.Contains("--issue-local-token", StringComparer.Ordinal);
var builder = WebApplication.CreateBuilder(args.Where(a => a != "--issue-local-token").ToArray());
var ingress = IngressSettings.Read(builder.Configuration, builder.Environment);
if (issueLocalToken)
{
    Console.WriteLine(IngressSecurity.CreateLocalToken(ingress));
    return;
}

builder.Logging.ClearProviders();
builder.Logging.AddJsonConsole(options =>
{
    options.IncludeScopes = true;
    options.TimestampFormat = "O";
    options.UseUtcTimestamp = true;
});
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 16 * 1024);
builder.Services.Configure<RouteHandlerOptions>(options => options.ThrowOnBadRequest = false);
builder.Services.AddIngressAuthentication(ingress);
builder.Services.AddSingleton(ingress);
builder.Services.AddSingleton<EventLedger>();
builder.Services.AddSingleton<IOrderReader, StubOrderReader>();
builder.Services.AddSingleton<IInventoryReader, StubInventoryReader>();
builder.Services.AddSingleton<IChannelNotifier, StubChannelNotifier>();
builder.Services.AddSingleton<ITicketWriter, StubTicketWriter>();
switch (builder.Configuration["Agent:ReasoningMode"])
{
    case "Stub": builder.Services.AddSingleton<IExceptionReasoner, StubExceptionReasoner>(); break;
    case "AzureOpenAI": builder.Services.AddSingleton<IExceptionReasoner, AzureOpenAIExceptionReasoner>(); break;
    default: throw new InvalidOperationException("Agent:ReasoningMode must be Stub or AzureOpenAI.");
}
builder.Services.AddSingleton<ShipmentWorkflow>();
var app = builder.Build();
// Resolve configuration-dependent services before accepting requests.
_ = app.Services.GetRequiredService<ShipmentWorkflow>();
_ = app.Services.GetRequiredService<EventLedger>();

app.Use(async (context, next) =>
{
    var supplied = context.Request.Headers["X-Correlation-ID"];
    var valid = supplied.Count == 0 || (supplied.Count == 1 && IsCorrelationId(supplied[0]));
    context.TraceIdentifier = supplied.Count == 1 && valid ? supplied[0]! : Guid.NewGuid().ToString();
    context.Response.Headers["X-Correlation-ID"] = context.TraceIdentifier;
    using var scope = app.Logger.BeginScope(new Dictionary<string, object> { ["CorrelationId"] = context.TraceIdentifier });
    if (ingress.IsLocal && (context.Connection.RemoteIpAddress is not { } remote || !IPAddress.IsLoopback(remote)))
    {
        await IngressSecurity.RejectAsync(context, 403, "local_requires_loopback");
        return;
    }
    // Authenticate before rejecting malformed headers so verified callers remain attributable.
    var authentication = await context.AuthenticateAsync();
    if (authentication.Succeeded && authentication.Principal is { } principal)
        context.User = principal;
    var callerId = IngressSecurity.CallerId(context.User);
    using var callerScope = app.Logger.BeginScope(new Dictionary<string, object>
    {
        ["CallerClientId"] = callerId ?? "unknown",
        ["CallerDisplayName"] = callerId is not null && ingress.AllowedCallers.TryGetValue(callerId, out var name) ? name : "unknown",
        ["IdentityMode"] = ingress.Mode
    });
    if (!valid)
    {
        await IngressSecurity.RejectAsync(context, 400, "invalid_correlation_id");
        return;
    }
    await next(context);
});
app.UseExceptionHandler(handler => handler.Run(async context =>
{
    context.Response.StatusCode = 500;
    await context.Response.WriteAsJsonAsync(new { error = "run_failed", correlationId = context.TraceIdentifier });
}));
app.UseAuthentication();
app.UseAuthorization();
// This runs before minimal-API JSON binding, so delegated callers cannot reach the handler.
app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/api/shipments") && context.User.Identity?.IsAuthenticated == true)
    {
        var failure = IngressSecurity.AuthorizationFailure(context.User, ingress);
        if (failure is not null)
        {
            await IngressSecurity.RejectAsync(context, 403, failure);
            return;
        }
    }
    await next(context);
    if (context.Request.Path == "/api/shipments" && context.Response.StatusCode is 400 or 413 or 415)
        app.Logger.LogWarning("Request rejected: {EventName} {Reason} {StatusCode}",
            "ingress.rejected", "invalid_request", context.Response.StatusCode);
});
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.MapPost("/api/shipments", async (ShipmentEvent shipment, HttpContext context, EventLedger ledger,
    ShipmentWorkflow workflow, CancellationToken cancellationToken) =>
{
    if (!shipment.IsValid())
    {
        app.Logger.LogWarning("Shipment rejected: {EventName} {Reason}", "shipment.invalid", "invalid_event");
        return Results.BadRequest(new { error = "invalid_event", correlationId = context.TraceIdentifier });
    }
    var callerId = IngressSecurity.CallerId(context.User)!;
    using var eventScope = app.Logger.BeginScope(new Dictionary<string, object> { ["SourceEventId"] = shipment.SourceEventId });
    var reservation = ledger.Reserve(callerId, shipment);
    if (reservation.State != "reserved")
    {
        app.Logger.LogInformation("Replay decision: {EventName} {Decision} {OriginalRunId}",
            "ingress.replay", reservation.State, reservation.Result?.RunId);
        return reservation.State == "completed"
            ? Results.Ok(new { replayed = true, result = reservation.Result })
            : Results.Json(new { error = reservation.State, correlationId = context.TraceIdentifier },
                statusCode: reservation.State == "capacity_reached" ? 503 : 409);
    }
    RunResult? result = null;
    var run = new RunContext(Guid.NewGuid().ToString(), context.TraceIdentifier, callerId, ingress.AllowedCallers[callerId]);
    using var runScope = app.Logger.BeginScope(new Dictionary<string, object> { ["RunId"] = run.RunId });
    try
    {
        result = await workflow.RunAsync(shipment, run, cancellationToken);
        return Results.Ok(new { replayed = false, result });
    }
    finally
    {
        // Retain failures because a downstream write may already have completed.
        ledger.Finish(callerId, shipment, result);
    }
}).RequireAuthorization();

app.Logger.LogInformation("Starting supply-chain sample: {IdentityMode} {ReasoningMode} {ToolMode}",
    ingress.Mode, builder.Configuration["Agent:ReasoningMode"], "Stub");
app.Run();

static bool IsCorrelationId(string? value) => !string.IsNullOrWhiteSpace(value) && value.Length <= 64 &&
    value.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.');
