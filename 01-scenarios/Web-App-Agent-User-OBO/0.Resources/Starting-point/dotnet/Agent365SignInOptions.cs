using Microsoft.Extensions.Configuration;

namespace LearnMcpAgent;

public sealed class Agent365SignInOptions
{
    public const string AzureAdSectionName = "AzureAd";
    public const string Agent365ObservabilitySectionName = "Agent365Observability";

    private Agent365SignInOptions(bool isEnabled, string agentUserScope)
    {
        IsEnabled = isEnabled;
        AgentUserScope = agentUserScope;
    }

    public bool IsEnabled { get; }

    public string AgentUserScope { get; }

    public static Agent365SignInOptions FromConfiguration(IConfiguration configuration)
    {
        var instance = configuration["AzureAd:Instance"];
        var tenantId = configuration["AzureAd:TenantId"];
        var clientId = configuration["AzureAd:ClientId"];
        var clientSecret = configuration["AzureAd:ClientSecret"];
        var callbackPath = configuration["AzureAd:CallbackPath"];
        var agentBlueprintId = configuration["Agent365Observability:AgentBlueprintId"];

        var requiredValues = new[] { instance, tenantId, clientId, clientSecret, callbackPath, agentBlueprintId };
        var isEnabled = requiredValues.All(IsConfiguredValue);
        var agentUserScope = isEnabled
            ? $"api://{agentBlueprintId}/access_agent_as_user"
            : string.Empty;

        return new Agent365SignInOptions(isEnabled, agentUserScope);
    }

    private static bool IsConfiguredValue(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        return !value.Contains('<')
            && !value.Contains('>')
            && !value.StartsWith("your-", StringComparison.OrdinalIgnoreCase)
            && !value.Equals("00000000-0000-0000-0000-000000000000", StringComparison.OrdinalIgnoreCase);
    }
}
