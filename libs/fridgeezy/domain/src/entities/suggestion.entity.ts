import { BaseEntity } from '../shared/common.types';
import { Difficulty, DifficultyLevel } from '../value-objects/difficulty.vo';
import { SuggestionName } from '../value-objects/suggestion-name.vo';
import {
  SuggestionCreatedEvent,
  SuggestionPromotedEvent,
} from '../events/suggestion-created.event';
import { IDomainEvent } from '../events/domain-event.interface';
import { BusinessRuleError } from '../shared/base-error';

/**
 * RecipeSuggestion aggregate root
 *
 * Represents a user-suggested recipe that can be promoted to a full recipe.
 * Contains rich domain behavior and business rules.
 *
 * @example
 * ```typescript
 * // Create a new suggestion
 * const name = SuggestionName.create('Chicken Curry');
 * const difficulty = Difficulty.create('medium');
 *
 * if (name.success && difficulty.success) {
 *   const suggestion = RecipeSuggestion.create(
 *     name.value,
 *     'A delicious curry dish',
 *     difficulty.value
 *   );
 *
 *   // Promote to recipe
 *   suggestion.promote('recipe-123');
 * }
 * ```
 */
export class RecipeSuggestion implements BaseEntity {
  private _domainEvents: IDomainEvent[] = [];

  private constructor(
    public readonly id: string,
    private _name: SuggestionName,
    private _description: string | null,
    private _difficulty: Difficulty | null,
    public readonly createdAt: string,
    private _promotedAt: string | null = null,
    private _promotedToRecipeId: string | null = null
  ) {}

  // ==================== Getters ====================

  /**
   * Get the suggestion name
   */
  get name(): string {
    return this._name.getValue();
  }

  /**
   * Get the name as a value object
   */
  get nameVO(): SuggestionName {
    return this._name;
  }

  /**
   * Get the description
   */
  get description(): string | null {
    return this._description;
  }

  /**
   * Get the difficulty level as a string
   */
  get difficulty(): DifficultyLevel | null {
    return this._difficulty?.getValue() ?? null;
  }

  /**
   * Get the difficulty as a value object
   */
  get difficultyVO(): Difficulty | null {
    return this._difficulty;
  }

  /**
   * Check if this suggestion has been promoted to a recipe
   */
  get isPromoted(): boolean {
    return this._promotedToRecipeId !== null;
  }

  /**
   * Get the timestamp when this suggestion was promoted
   */
  get promotedAt(): string | null {
    return this._promotedAt;
  }

  /**
   * Get the ID of the recipe this suggestion was promoted to
   */
  get promotedToRecipeId(): string | null {
    return this._promotedToRecipeId;
  }

  /**
   * Get pending domain events
   */
  get domainEvents(): IDomainEvent[] {
    return [...this._domainEvents];
  }

  // ==================== Factory Methods ====================

  /**
   * Create a new RecipeSuggestion
   *
   * This factory method creates a new suggestion with a generated ID
   * and adds a SuggestionCreatedEvent to the domain events.
   *
   * @param name The suggestion name (value object)
   * @param description Optional description
   * @param difficulty Optional difficulty level (value object)
   * @returns New RecipeSuggestion instance
   */
  static create(
    name: SuggestionName,
    description: string | null,
    difficulty: Difficulty | null
  ): RecipeSuggestion {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const suggestion = new RecipeSuggestion(
      id,
      name,
      description,
      difficulty,
      now
    );

    // Add domain event
    suggestion.addDomainEvent(
      new SuggestionCreatedEvent(id, name.getValue(), now)
    );

    return suggestion;
  }

  /**
   * Reconstitute a RecipeSuggestion from persistence
   *
   * Use this when loading from the database. Does not generate events.
   *
   * @param data Raw data from database
   * @returns RecipeSuggestion instance
   */
  static fromPersistence(data: {
    id: string;
    name: string;
    description: string | null;
    difficulty: DifficultyLevel | null;
    createdAt: string;
    promotedAt: string | null;
    promotedToRecipeId: string | null;
  }): RecipeSuggestion {
    const nameResult = SuggestionName.create(data.name);
    if (!nameResult.success) {
      // In production, consider logging this and using a fallback
      throw nameResult.error;
    }

    const difficultyVO = data.difficulty
      ? Difficulty.createUnsafe(data.difficulty)
      : null;

    return new RecipeSuggestion(
      data.id,
      nameResult.value,
      data.description,
      difficultyVO,
      data.createdAt,
      data.promotedAt,
      data.promotedToRecipeId
    );
  }

  // ==================== Domain Methods ====================

  /**
   * Promote this suggestion to a recipe
   *
   * @param recipeId The ID of the recipe this suggestion is promoted to
   * @throws BusinessRuleError if already promoted
   */
  promote(recipeId: string): void {
    if (this.isPromoted) {
      throw new BusinessRuleError(
        'Cannot promote a suggestion that is already promoted',
        'ALREADY_PROMOTED'
      );
    }

    this._promotedToRecipeId = recipeId;
    this._promotedAt = new Date().toISOString();

    // Add domain event
    this.addDomainEvent(new SuggestionPromotedEvent(this.id, recipeId));
  }

  /**
   * Update the description
   *
   * @param description New description (can be empty or null)
   */
  updateDescription(description: string | null): void {
    this._description = description;
  }

  /**
   * Update the difficulty level
   *
   * @param difficulty New difficulty level (value object)
   */
  updateDifficulty(difficulty: Difficulty | null): void {
    this._difficulty = difficulty;
  }

  /**
   * Update the name
   *
   * @param name New name (value object)
   */
  updateName(name: SuggestionName): void {
    this._name = name;
  }

  /**
   * Check if this suggestion matches a search query
   *
   * @param query Search query
   * @returns true if name or description contains the query
   */
  matchesQuery(query: string): boolean {
    const lowerQuery = query.toLowerCase();

    // Check name
    if (this._name.contains(query, false)) {
      return true;
    }

    // Check description
    if (this._description && this._description.toLowerCase().includes(lowerQuery)) {
      return true;
    }

    return false;
  }

  // ==================== Event Management ====================

  /**
   * Add a domain event
   */
  private addDomainEvent(event: IDomainEvent): void {
    this._domainEvents.push(event);
  }

  /**
   * Clear all domain events
   * Call this after dispatching events
   */
  clearDomainEvents(): void {
    this._domainEvents = [];
  }

  // ==================== Persistence Mapping ====================

  /**
   * Convert to persistence format (snake_case for database)
   *
   * @returns Object ready for database insertion
   */
  toPersistence() {
    return {
      id: this.id,
      name: this._name.getValue(),
      description: this._description,
      difficulty: this._difficulty?.getValue() ?? null,
      created_at: this.createdAt,
      promoted_at: this._promotedAt,
      promoted_to_recipe_id: this._promotedToRecipeId,
    };
  }

  // ==================== Equality ====================

  /**
   * Check if this suggestion is equal to another (by ID)
   */
  equals(other: RecipeSuggestion): boolean {
    return this.id === other.id;
  }
}
