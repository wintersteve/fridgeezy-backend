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
