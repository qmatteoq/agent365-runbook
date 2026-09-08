namespace SupplyChainAgent;

public sealed record OrderDetails(string OrderId, string Sku, int Quantity, string Destination);
public sealed record InventoryDetails(string Sku, int AvailableUnits, string Warehouse);
public interface IOrderReader
{
    Task<OrderDetails> ReadAsync(string orderId, RunContext run, CancellationToken cancellationToken);
}
public interface IInventoryReader
{
    Task<InventoryDetails> ReadAsync(string sku, RunContext run, CancellationToken cancellationToken);
}
public interface IChannelNotifier
{
    Task<string> NotifyAsync(ShipmentEvent shipment, string summary, RunContext run, CancellationToken cancellationToken);
}
public interface ITicketWriter
{
    Task<string> CreateAsync(ShipmentEvent shipment, string summary, RunContext run, CancellationToken cancellationToken);
}

public sealed class StubOrderReader : IOrderReader
{
    public Task<OrderDetails> ReadAsync(string orderId, RunContext run, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(new OrderDetails(orderId, "WIDGET-42", 20, "Milan"));
    }
}

public sealed class StubInventoryReader : IInventoryReader
{
    public Task<InventoryDetails> ReadAsync(string sku, RunContext run, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(new InventoryDetails(sku, 50, "Bergamo"));
    }
}

public sealed class StubChannelNotifier : IChannelNotifier
{
    public Task<string> NotifyAsync(ShipmentEvent shipment, string summary, RunContext run, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult($"stub-notification-{run.RunId}");
    }
}

public sealed class StubTicketWriter : ITicketWriter
{
    public Task<string> CreateAsync(ShipmentEvent shipment, string summary, RunContext run, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult($"stub-ticket-{run.RunId}");
    }
}
