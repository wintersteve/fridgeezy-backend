/**
 * Base interface for all domain events
 *
 * Domain events represent significant occurrences within the domain
 * that other parts of the system may want to react to.
 *
 * @example
 * ```typescript
 * export class RecipeSuggestionCreatedEvent implements IDomainEvent {
 *   public readonly eventName = 'RecipeSuggestionCreated';
 *   public readonly occurredAt: Date;
 *
 *   constructor(
 *     public readonly aggregateId: string,
 *     public readonly suggestionName: string
 *   ) {
 *     this.occurredAt = new Date();
 *   }
 * }
 * ```
 */
export interface IDomainEvent {
  /**
   * When the event occurred
   */
  occurredAt: Date;

  /**
   * Name of the event (e.g., 'RecipeSuggestionCreated')
   */
  eventName: string;

  /**
   * ID of the aggregate root that generated this event
   */
  aggregateId: string;
}

/**
 * Handler interface for domain events
 *
 * Implement this interface to handle specific domain events
 *
 * @example
 * ```typescript
 * class SendNotificationHandler implements IDomainEventHandler<RecipeSuggestionCreatedEvent> {
 *   async handle(event: RecipeSuggestionCreatedEvent): Promise<void> {
 *     await notificationService.send(`New suggestion: ${event.suggestionName}`);
 *   }
 * }
 * ```
 */
export interface IDomainEventHandler<T extends IDomainEvent> {
  /**
   * Handle the domain event
   */
  handle(event: T): Promise<void> | void;
}
