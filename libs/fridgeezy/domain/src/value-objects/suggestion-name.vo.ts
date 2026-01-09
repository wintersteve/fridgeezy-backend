import { ValidationError } from '../shared/base-error';
import { Result, success, failure } from '../shared/result';

/**
 * Suggestion name value object with validation
 *
 * Encapsulates suggestion name with:
 * - Length validation (3-100 characters)
 * - Trimming whitespace
 * - Type safety
 *
 * @example
 * ```typescript
 * const result = SuggestionName.create('  Chicken Curry  ');
 * if (result.success) {
 *   const name = result.value;
 *   console.log(name.getValue()); // 'Chicken Curry' (trimmed)
 *   console.log(name.length()); // 13
 * }
 * ```
 */
export class SuggestionName {
  private static readonly MIN_LENGTH = 3;
  private static readonly MAX_LENGTH = 100;

  private constructor(private readonly value: string) {}

  /**
   * Create a SuggestionName value object with validation
   *
   * @param value The name string
   * @returns Result containing either a valid SuggestionName or a ValidationError
   */
  static create(value: string): Result<SuggestionName, ValidationError> {
    // Check for null/undefined/empty
    if (!value || value.trim().length === 0) {
      return failure(
        new ValidationError('Suggestion name cannot be empty', 'name')
      );
    }

    const trimmed = value.trim();

    // Check minimum length
    if (trimmed.length < this.MIN_LENGTH) {
      return failure(
        new ValidationError(
          `Suggestion name must be at least ${this.MIN_LENGTH} characters long`,
          'name'
        )
      );
    }

    // Check maximum length
    if (trimmed.length > this.MAX_LENGTH) {
      return failure(
        new ValidationError(
          `Suggestion name must not exceed ${this.MAX_LENGTH} characters`,
          'name'
        )
      );
    }

    return success(new SuggestionName(trimmed));
  }

  /**
   * Create a SuggestionName without validation
   * Use only when you're certain the value is valid (e.g., from database)
   *
   * @param value The name
   * @returns SuggestionName instance
   */
  static createUnsafe(value: string): SuggestionName {
    return new SuggestionName(value.trim());
  }

  /**
   * Get the underlying name value
   */
  getValue(): string {
    return this.value;
  }

  /**
   * Get the length of the name
   */
  length(): number {
    return this.value.length;
  }

  /**
   * Check if this name is equal to another
   *
   * @param other The other SuggestionName to compare
   * @param caseSensitive Whether comparison should be case-sensitive (default: false)
   */
  equals(other: SuggestionName, caseSensitive = false): boolean {
    if (caseSensitive) {
      return this.value === other.value;
    }
    return this.value.toLowerCase() === other.value.toLowerCase();
  }

  /**
   * Check if this name contains a substring
   *
   * @param substring The substring to search for
   * @param caseSensitive Whether search should be case-sensitive (default: false)
   */
  contains(substring: string, caseSensitive = false): boolean {
    if (caseSensitive) {
      return this.value.includes(substring);
    }
    return this.value.toLowerCase().includes(substring.toLowerCase());
  }

  /**
   * Check if this name starts with a prefix
   */
  startsWith(prefix: string, caseSensitive = false): boolean {
    if (caseSensitive) {
      return this.value.startsWith(prefix);
    }
    return this.value.toLowerCase().startsWith(prefix.toLowerCase());
  }

  /**
   * String representation
   */
  toString(): string {
    return this.value;
  }
}
