import { IDomainEvent, IDomainEventHandler } from './domain-event.interface';

/**
 * Simple in-memory event dispatcher for domain events.
 *
 * This can be replaced with a message queue (RabbitMQ, Kafka, etc.)
 * in production for better scalability and reliability.
 *
 * @example
 * ```typescript
 * // Register a handler
 * eventDispatcher.register('RecipeSuggestionCreated', new SendNotificationHandler());
 *
 * // Dispatch an event
 * await eventDispatcher.dispatch(new RecipeSuggestionCreatedEvent('123', 'Chicken Curry'));
 * ```
 */
export class EventDispatcher {
  private handlers: Map<string, IDomainEventHandler<any>[]> = new Map();

  /**
   * Register an event handler for a specific event type
   *
   * @param eventName The name of the event to listen for
   * @param handler The handler to execute when the event is dispatched
   */
  register<T extends IDomainEvent>(
    eventName: string,
    handler: IDomainEventHandler<T>
  ): void {
    const existing = this.handlers.get(eventName) || [];
    this.handlers.set(eventName, [...existing, handler]);
  }

  /**
   * Unregister a specific event handler
   *
   * @param eventName The event name
   * @param handler The handler to remove
   */
  unregister<T extends IDomainEvent>(
    eventName: string,
    handler: IDomainEventHandler<T>
  ): void {
    const existing = this.handlers.get(eventName) || [];
    this.handlers.set(
      eventName,
      existing.filter((h) => h !== handler)
    );
  }

  /**
   * Dispatch an event to all registered handlers
   *
   * Handlers are executed in parallel. If a handler throws an error,
   * it will be logged but will not prevent other handlers from executing.
   *
   * @param event The event to dispatch
   */
  async dispatch(event: IDomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.eventName) || [];

    if (handlers.length === 0) {
      return;
    }

    // Execute all handlers in parallel
    const results = await Promise.allSettled(
      handlers.map((handler) => Promise.resolve(handler.handle(event)))
    );

    // Log any errors but don't throw
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(
          `Error handling event ${event.eventName} with handler ${index}:`,
          result.reason
        );
      }
    });
  }

  /**
   * Dispatch multiple events sequentially
   *
   * @param events Array of events to dispatch
   */
  async dispatchAll(events: IDomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.dispatch(event);
    }
  }

  /**
   * Clear all registered handlers
   * Useful for testing
   */
  clear(): void {
    this.handlers.clear();
  }

  /**
   * Get the number of handlers registered for an event
   *
   * @param eventName The event name
   * @returns Number of registered handlers
   */
  getHandlerCount(eventName: string): number {
    return this.handlers.get(eventName)?.length || 0;
  }
}

/**
 * Singleton instance of the event dispatcher
 * Use this throughout the application
 */
export const eventDispatcher = new EventDispatcher();
