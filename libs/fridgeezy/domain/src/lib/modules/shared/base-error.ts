/**
 * Base domain error class.
 * All domain-specific errors should extend this class.
 *
 * Provides structured error information with error codes and metadata
 * for better error handling and debugging.
 */
export abstract class DomainError extends Error {
  /**
   * @param message Human-readable error message
   * @param code Machine-readable error code
   * @param metadata Additional context about the error
   */
  constructor(
    message: string,
    public readonly code: string,
    public readonly metadata?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Returns a JSON-serializable representation of the error
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      metadata: this.metadata,
    };
  }
}

/**
 * Error thrown when an entity is not found
 *
 * @example
 * ```typescript
 * throw new NotFoundError('RecipeSuggestion', '123');
 * throw new NotFoundError('Recipe', { name: 'Chicken Curry' });
 * ```
 */
export class NotFoundError extends DomainError {
  constructor(entityName: string, identifier: string | Record<string, unknown>) {
    super(
      `${entityName} not found`,
      'NOT_FOUND',
      { entityName, identifier }
    );
  }
}

/**
 * Error thrown when domain validation fails
 *
 * @example
 * ```typescript
 * throw new ValidationError('Name must be at least 3 characters', 'name');
 * throw new ValidationError('Invalid difficulty level');
 * ```
 */
export class ValidationError extends DomainError {
  constructor(message: string, field?: string) {
    super(message, 'VALIDATION_ERROR', { field });
  }
}

/**
 * Error thrown when a database or persistence operation fails
 *
 * @example
 * ```typescript
 * throw new PersistenceError('Failed to insert record', originalError);
 * ```
 */
export class PersistenceError extends DomainError {
  constructor(message: string, cause?: Error) {
    super(message, 'PERSISTENCE_ERROR', {
      cause: cause?.message,
      stack: cause?.stack,
    });
  }
}

/**
 * Error thrown when a unique constraint is violated or a conflict occurs
 *
 * @example
 * ```typescript
 * throw new ConflictError('Suggestion with this name already exists', 'name');
 * throw new ConflictError('Recipe already in collection');
 * ```
 */
export class ConflictError extends DomainError {
  constructor(message: string, field?: string) {
    super(message, 'CONFLICT_ERROR', { field });
  }
}

/**
 * Error thrown when an operation is not authorized
 *
 * @example
 * ```typescript
 * throw new UnauthorizedError('User does not have permission to delete this recipe');
 * ```
 */
export class UnauthorizedError extends DomainError {
  constructor(message: string) {
    super(message, 'UNAUTHORIZED', {});
  }
}

/**
 * Error thrown when a business rule is violated
 *
 * @example
 * ```typescript
 * throw new BusinessRuleError('Cannot promote an already promoted suggestion');
 * ```
 */
export class BusinessRuleError extends DomainError {
  constructor(message: string, rule?: string) {
    super(message, 'BUSINESS_RULE_VIOLATION', { rule });
  }
}

/**
 * Error thrown for invalid operations
 *
 * @example
 * ```typescript
 * throw new InvalidOperationError('Cannot update a deleted entity');
 * ```
 */
export class InvalidOperationError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_OPERATION', {});
  }
}
