namespace SupplyChainAgent;

public sealed record ShipmentEvent(string SourceEventId, string OrderId, int DelayHours)
{
    public bool IsValid() => IsIdentifier(SourceEventId) && IsIdentifier(OrderId) && DelayHours is > 0 and <= 720;

    private static bool IsIdentifier(string? value) =>
        !string.IsNullOrWhiteSpace(value) && value.Length <= 100 &&
        value.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.' or ':');
}

public sealed record RunContext(string RunId, string CorrelationId, string CallerClientId, string CallerDisplayName);
public sealed record RunResult(string RunId, string CorrelationId, string SourceEventId, string ReasoningMode,
    string Summary, string NotificationId, string TicketId);
public sealed record EventReservation(string State, RunResult? Result = null);

public sealed class EventLedger(IConfiguration configuration)
{
    private sealed record Entry(ShipmentEvent Event, string State, RunResult? Result = null);
    private readonly Dictionary<(string Caller, string EventId), Entry> entries = [];
    private readonly object gate = new();
    private readonly int capacity = configuration.GetValue<int?>("Agent:MaxRememberedEvents") is > 0 and var value
        ? value : throw new InvalidOperationException("Agent:MaxRememberedEvents must be positive.");

    public EventReservation Reserve(string caller, ShipmentEvent shipment)
    {
        lock (gate)
        {
            var key = (caller, shipment.SourceEventId);
            if (entries.TryGetValue(key, out var existing))
                return existing.Event != shipment
                    ? new("payload_conflict")
                    : new(existing.State, existing.Result);
            if (entries.Count >= capacity)
                return new("capacity_reached");
            entries.Add(key, new(shipment, "in_progress"));
            return new("reserved");
        }
    }

    public void Finish(string caller, ShipmentEvent shipment, RunResult? result)
    {
        lock (gate)
            entries[(caller, shipment.SourceEventId)] = new(shipment, result is null ? "failed" : "completed", result);
    }
}
