import { ValidationError } from '../shared/base-error';
import { Result, success, failure } from '../shared/result';

const MIN_LENGTH = 3;
const MAX_LENGTH = 100;

/**
 * Validate a suggestion name
 *
 * Ensures the name:
 * - Is not empty
 * - Is between 3-100 characters (after trimming)
 * - Returns trimmed value
 *
 * @param value The name string to validate
 * @returns Result containing the trimmed name or a ValidationError
 *
 * @example
 * ```typescript
 * const result = validateSuggestionName('  Chicken Curry  ');
 * if (result.success) {
 *   console.log(result.value); // 'Chicken Curry' (trimmed)
 * }
 * ```
 */
export function validateSuggestionName(
  value: string
): Result<string, ValidationError> {
  // Check for null/undefined/empty
  if (!value || value.trim().length === 0) {
    return failure(
      new ValidationError('Suggestion name cannot be empty', 'name')
    );
  }

  const trimmed = value.trim();

  // Check minimum length
  if (trimmed.length < MIN_LENGTH) {
    return failure(
      new ValidationError(
        `Suggestion name must be at least ${MIN_LENGTH} characters long`,
        'name'
      )
    );
  }

  // Check maximum length
  if (trimmed.length > MAX_LENGTH) {
    return failure(
      new ValidationError(
        `Suggestion name must not exceed ${MAX_LENGTH} characters`,
        'name'
      )
    );
  }

  return success(trimmed);
}

/**
 * Check if a name contains a substring
 *
 * @param name The name to search in
 * @param substring The substring to search for
 * @param caseSensitive Whether search should be case-sensitive (default: false)
 */
export function nameContains(
  name: string,
  substring: string,
  caseSensitive = false
): boolean {
  if (caseSensitive) {
    return name.includes(substring);
  }
  return name.toLowerCase().includes(substring.toLowerCase());
}

/**
 * Check if a name starts with a prefix
 *
 * @param name The name to check
 * @param prefix The prefix to search for
 * @param caseSensitive Whether search should be case-sensitive (default: false)
 */
export function nameStartsWith(
  name: string,
  prefix: string,
  caseSensitive = false
): boolean {
  if (caseSensitive) {
    return name.startsWith(prefix);
  }
  return name.toLowerCase().startsWith(prefix.toLowerCase());
}

/**
 * Check if two names are equal
 *
 * @param name1 First name
 * @param name2 Second name
 * @param caseSensitive Whether comparison should be case-sensitive (default: false)
 */
export function namesEqual(
  name1: string,
  name2: string,
  caseSensitive = false
): boolean {
  if (caseSensitive) {
    return name1 === name2;
  }
  return name1.toLowerCase() === name2.toLowerCase();
}
