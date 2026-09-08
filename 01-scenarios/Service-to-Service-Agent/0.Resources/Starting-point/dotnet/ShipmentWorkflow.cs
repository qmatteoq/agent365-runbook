using System.Diagnostics;

namespace SupplyChainAgent;

public sealed class ShipmentWorkflow(IOrderReader orders, IInventoryReader inventory,
    IChannelNotifier notifier, ITicketWriter tickets, IExceptionReasoner reasoner, ILogger<ShipmentWorkflow> logger)
{
    public async Task<RunResult> RunAsync(ShipmentEvent shipment, RunContext run, CancellationToken cancellationToken)
    {
        var started = Stopwatch.GetTimestamp();
        var outcome = "failed";
        logger.LogInformation("Run started: {EventName} {ReasoningMode}", "run.started", reasoner.Mode);
        try
        {
            var order = await ExecuteToolAsync("erp", "read_order", "one_order", () => orders.ReadAsync(shipment.OrderId, run, cancellationToken));
            var stock = await ExecuteToolAsync("inventory", "check_stock", "one_sku", () => inventory.ReadAsync(order.Sku, run, cancellationToken));
            var summary = await reasoner.SummarizeAsync(shipment, order, stock, cancellationToken);
            var notification = await ExecuteToolAsync("channel", "notify_operations", "one_channel",
                () => notifier.NotifyAsync(shipment, summary, run, cancellationToken));
            var ticket = await ExecuteToolAsync("itsm", "create_ticket", "one_queue",
                () => tickets.CreateAsync(shipment, summary, run, cancellationToken));
            outcome = "succeeded";
            return new(run.RunId, run.CorrelationId, shipment.SourceEventId, reasoner.Mode, summary, notification, ticket);
        }
        finally
        {
            logger.LogInformation("Run ended: {EventName} {Outcome} {DurationMs}",
                "run.ended", outcome, Stopwatch.GetElapsedTime(started).TotalMilliseconds);
        }
    }

    private async Task<T> ExecuteToolAsync<T>(string target, string operation, string dataScope, Func<Task<T>> execute)
    {
        var started = Stopwatch.GetTimestamp();
        var outcome = "failed";
        try
        {
            var result = await execute();
            outcome = "succeeded";
            return result;
        }
        finally
        {
            logger.LogInformation("Tool ended: {EventName} {TargetSystem} {Operation} {DataScope} {PermissionMode} {ToolMode} {Outcome} {DurationMs}",
                "tool.ended", target, operation, dataScope, "none", "Stub", outcome, Stopwatch.GetElapsedTime(started).TotalMilliseconds);
        }
    }
}
