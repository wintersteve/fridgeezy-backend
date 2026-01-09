import { ValidationError } from '../shared/base-error';
import { Result, success, failure } from '../shared/result';

/**
 * Valid difficulty levels for recipe suggestions
 */
export type DifficultyLevel = 'easy' | 'medium' | 'hard';

/**
 * Difficulty value object with validation and business rules
 *
 * Encapsulates difficulty level with:
 * - Validation logic
 * - Domain behavior
 * - Type safety
 *
 * @example
 * ```typescript
 * const result = Difficulty.create('medium');
 * if (result.success) {
 *   const difficulty = result.value;
 *   console.log(difficulty.getValue()); // 'medium'
 *   console.log(difficulty.isHarderThan(Difficulty.createUnsafe('easy'))); // true
 * }
 * ```
 */
export class Difficulty {
  private constructor(private readonly value: DifficultyLevel) {}

  /**
   * Create a Difficulty value object with validation
   *
   * @param value The difficulty level string
   * @returns Result containing either a valid Difficulty or a ValidationError
   */
  static create(value: string): Result<Difficulty, ValidationError> {
    if (!this.isValid(value)) {
      return failure(
        new ValidationError(
          `Invalid difficulty level: "${value}". Must be one of: easy, medium, hard`,
          'difficulty'
        )
      );
    }
    return success(new Difficulty(value as DifficultyLevel));
  }

  /**
   * Create a Difficulty without validation
   * Use only when you're certain the value is valid (e.g., from database)
   *
   * @param value The difficulty level
   * @returns Difficulty instance
   */
  static createUnsafe(value: DifficultyLevel): Difficulty {
    return new Difficulty(value);
  }

  /**
   * Validate if a string is a valid difficulty level
   */
  private static isValid(value: string): value is DifficultyLevel {
    return ['easy', 'medium', 'hard'].includes(value);
  }

  /**
   * Get the underlying difficulty level value
   */
  getValue(): DifficultyLevel {
    return this.value;
  }

  /**
   * Check if this difficulty is equal to another
   */
  equals(other: Difficulty): boolean {
    return this.value === other.value;
  }

  /**
   * Check if this difficulty is harder than another
   *
   * @example
   * ```typescript
   * const hard = Difficulty.createUnsafe('hard');
   * const easy = Difficulty.createUnsafe('easy');
   * console.log(hard.isHarderThan(easy)); // true
   * ```
   */
  isHarderThan(other: Difficulty): boolean {
    const order: Record<DifficultyLevel, number> = {
      easy: 1,
      medium: 2,
      hard: 3,
    };
    return order[this.value] > order[other.value];
  }

  /**
   * Check if this difficulty is easier than another
   */
  isEasierThan(other: Difficulty): boolean {
    const order: Record<DifficultyLevel, number> = {
      easy: 1,
      medium: 2,
      hard: 3,
    };
    return order[this.value] < order[other.value];
  }

  /**
   * Get numeric representation (1=easy, 2=medium, 3=hard)
   */
  toNumeric(): number {
    const order: Record<DifficultyLevel, number> = {
      easy: 1,
      medium: 2,
      hard: 3,
    };
    return order[this.value];
  }

  /**
   * String representation
   */
  toString(): string {
    return this.value;
  }
}
