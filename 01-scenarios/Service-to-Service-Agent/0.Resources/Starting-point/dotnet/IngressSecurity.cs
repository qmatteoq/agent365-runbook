using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;

namespace SupplyChainAgent;

public sealed class IngressSettings
{
    public string Mode { get; init; } = "Entra";
    public string TenantId { get; init; } = "";
    public string Audience { get; init; } = "";
    public string RequiredRole { get; init; } = "Shipment.Invoke";
    public Dictionary<string, string> AllowedCallers { get; init; } = new(StringComparer.OrdinalIgnoreCase);
    public string LocalSigningKey { get; init; } = "";
    public bool IsLocal => Mode == "Local";
    public string Issuer => IsLocal
        ? "https://supply-chain.local"
        : $"https://login.microsoftonline.com/{TenantId}/v2.0";

    public static IngressSettings Read(IConfiguration configuration, IHostEnvironment environment)
    {
        var settings = configuration.GetSection("Ingress").Get<IngressSettings>()
            ?? throw new InvalidOperationException("Configure the Ingress section.");
        if (settings.Mode is not ("Local" or "Entra"))
            throw new InvalidOperationException("Ingress:Mode must be Local or Entra.");
        if (settings.IsLocal && !environment.IsDevelopment())
            throw new InvalidOperationException("Local authentication is allowed only in Development.");
        if (!Guid.TryParse(settings.TenantId, out _) || !Guid.TryParse(settings.Audience, out _))
            throw new InvalidOperationException("Ingress:TenantId and Audience must be GUIDs. Audience is the webhook API client ID.");
        if (string.IsNullOrWhiteSpace(settings.RequiredRole) || settings.AllowedCallers.Count == 0 ||
            settings.AllowedCallers.Any(c => !Guid.TryParse(c.Key, out _) || string.IsNullOrWhiteSpace(c.Value)))
            throw new InvalidOperationException("Configure RequiredRole and at least one AllowedCallers entry (client ID: display name).");
        if (settings.IsLocal && Encoding.UTF8.GetByteCount(settings.LocalSigningKey) < 32)
            throw new InvalidOperationException("Set Ingress:LocalSigningKey to a random secret of at least 32 bytes using user-secrets or an environment variable.");
        return settings;
    }
}

public static class IngressSecurity
{
    public static void AddIngressAuthentication(this IServiceCollection services, IngressSettings settings)
    {
        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(options =>
        {
            options.MapInboundClaims = false;
            options.IncludeErrorDetails = false;
            options.TokenValidationParameters = new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidIssuer = settings.Issuer,
                ValidateAudience = true,
                ValidAudience = settings.Audience,
                ValidateLifetime = true,
                RequireExpirationTime = true,
                RequireSignedTokens = true,
                ValidateIssuerSigningKey = true,
                ClockSkew = TimeSpan.FromSeconds(30),
                RoleClaimType = "roles",
                ValidAlgorithms = [settings.IsLocal ? SecurityAlgorithms.HmacSha256 : SecurityAlgorithms.RsaSha256]
            };
            if (settings.IsLocal)
                options.TokenValidationParameters.IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(settings.LocalSigningKey));
            else
                options.Authority = settings.Issuer;

            options.Events = new JwtBearerEvents
            {
                OnChallenge = context =>
                {
                    context.HandleResponse();
                    return RejectAsync(context.HttpContext, StatusCodes.Status401Unauthorized,
                        context.AuthenticateFailure is null ? "missing_token" : "invalid_token");
                }
            };
        });
        services.AddAuthorization();
    }

    public static string? CallerId(ClaimsPrincipal principal)
    {
        var value = principal.Identity?.IsAuthenticated == true
            ? principal.FindFirst("azp")?.Value ?? principal.FindFirst("appid")?.Value : null;
        return Guid.TryParse(value, out var id) ? id.ToString() : null;
    }

    public static string? AuthorizationFailure(ClaimsPrincipal principal, IngressSettings settings)
    {
        if (principal.HasClaim(c => c.Type is "scp" or "upn" or "preferred_username" or "unique_name") ||
            !principal.HasClaim("idtyp", "app"))
            return "app_only_required";
        if (!string.Equals(principal.FindFirst("tid")?.Value, settings.TenantId, StringComparison.OrdinalIgnoreCase))
            return "wrong_tenant";
        var caller = CallerId(principal);
        if (caller is null || !settings.AllowedCallers.ContainsKey(caller))
            return "caller_not_allowed";
        if (!principal.IsInRole(settings.RequiredRole))
            return "missing_role";
        return null;
    }

    public static Task RejectAsync(HttpContext context, int status, string reason)
    {
        var caller = CallerId(context.User) ?? "unknown";
        context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Ingress")
            .LogWarning("S2S rejection: {EventName} {Reason} {CallerClientId} {CorrelationId}",
                "ingress.rejected", reason, caller, context.TraceIdentifier);
        context.Response.StatusCode = status;
        if (status == StatusCodes.Status401Unauthorized)
            context.Response.Headers.WWWAuthenticate = "Bearer";
        return context.Response.WriteAsJsonAsync(new { error = reason, correlationId = context.TraceIdentifier });
    }

    public static string CreateLocalToken(IngressSettings settings)
    {
        if (!settings.IsLocal)
            throw new InvalidOperationException("Local tokens cannot be issued in Entra mode.");
        var callerId = settings.AllowedCallers.Keys.First();
        var token = new JwtSecurityToken(
            issuer: settings.Issuer,
            audience: settings.Audience,
            claims: [
                new Claim("azp", callerId), new Claim("tid", settings.TenantId),
                new Claim("idtyp", "app"), new Claim("roles", settings.RequiredRole)
            ],
            notBefore: DateTime.UtcNow.AddSeconds(-5),
            expires: DateTime.UtcNow.AddHours(1),
            signingCredentials: new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(settings.LocalSigningKey)), SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
