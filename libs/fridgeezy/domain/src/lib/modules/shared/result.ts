/**
 * Result type for explicit error handling without exceptions.
 *
 * This pattern provides type-safe error handling by forcing consumers
 * to explicitly handle both success and failure cases.
 *
 * @example
 * ```typescript
 * const result = await someOperation();
 * if (result.success) {
 *   console.log(result.value);
 * } else {
 *   console.error(result.error.message);
 * }
 * ```
 */
export type Result<T, E = Error> =
  | { success: true; value: T }
  | { success: false; error: E };

/**
 * Creates a successful Result
 */
export const success = <T>(value: T): Result<T, never> => ({
  success: true,
  value,
});

/**
 * Creates a failed Result
 */
export const failure = <E>(error: E): Result<never, E> => ({
  success: false,
  error,
});

/**
 * Type guard to check if Result is successful
 */
export const isSuccess = <T, E>(
  result: Result<T, E>
): result is { success: true; value: T } => result.success;

/**
 * Type guard to check if Result is a failure
 */
export const isFailure = <T, E>(
  result: Result<T, E>
): result is { success: false; error: E } => !result.success;

/**
 * Maps a successful Result value to a new value
 */
export const map = <T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U
): Result<U, E> => {
  if (result.success) {
    return success(fn(result.value));
  }
  return result;
};

/**
 * Maps a failed Result error to a new error
 */
export const mapError = <T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F
): Result<T, F> => {
  if (!result.success) {
    return failure(fn(result.error));
  }
  return result;
};

/**
 * Chains Result-returning operations
 */
export const flatMap = <T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> => {
  if (result.success) {
    return fn(result.value);
  }
  return result;
};

/**
 * Unwraps a Result, throwing if it's an error
 * Use with caution - prefer explicit error handling
 */
export const unwrap = <T, E>(result: Result<T, E>): T => {
  if (result.success) {
    return result.value;
  }
  throw result.error;
};

/**
 * Unwraps a Result, returning a default value if it's an error
 */
export const unwrapOr = <T, E>(result: Result<T, E>, defaultValue: T): T => {
  if (result.success) {
    return result.value;
  }
  return defaultValue;
};
