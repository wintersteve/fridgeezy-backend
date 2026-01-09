import { IDomainEvent } from './domain-event.interface';

/**
 * Domain event fired when a new recipe suggestion is created
 *
 * This event can be used for:
 * - Audit logging
 * - Sending notifications
 * - Triggering analytics
 * - Inter-module communication
 *
 * @example
 * ```typescript
 * const event = new SuggestionCreatedEvent(
 *   '123',
 *   'Chicken Curry',
 *   new Date().toISOString()
 * );
 * await eventDispatcher.dispatch(event);
 * ```
 */
export class SuggestionCreatedEvent implements IDomainEvent {
  public readonly eventName = 'SuggestionCreated';
  public readonly occurredAt: Date;

  /**
   * @param aggregateId The ID of the created suggestion
   * @param name The name of the created suggestion
   * @param createdAt ISO timestamp when the suggestion was created
   */
  constructor(
    public readonly aggregateId: string,
    public readonly name: string,
    createdAt: string
  ) {
    this.occurredAt = new Date(createdAt);
  }
}

/**
 * Domain event fired when a suggestion is promoted to a recipe
 *
 * @example
 * ```typescript
 * const event = new SuggestionPromotedEvent('suggestion-123', 'recipe-456');
 * await eventDispatcher.dispatch(event);
 * ```
 */
export class SuggestionPromotedEvent implements IDomainEvent {
  public readonly eventName = 'SuggestionPromoted';
  public readonly occurredAt: Date;

  /**
   * @param aggregateId The ID of the promoted suggestion
   * @param recipeId The ID of the recipe it was promoted to
   */
  constructor(
    public readonly aggregateId: string,
    public readonly recipeId: string
  ) {
    this.occurredAt = new Date();
  }
}
