/**
 * Common domain types used across modules
 */

/**
 * Entity identifier type
 */
export type EntityId = string;

/**
 * ISO 8601 timestamp string
 */
export type Timestamp = string;

/**
 * Base entity interface with common fields
 * All domain entities should include these fields
 */
export interface BaseEntity {
  id: EntityId;
  createdAt: Timestamp;
}

/**
 * Paginated response wrapper
 * Used when returning lists of entities with pagination metadata
 *
 * @example
 * ```typescript
 * const result: PaginatedResult<Recipe> = {
 *   data: recipes,
 *   total: 100,
 *   page: 1,
 *   pageSize: 20,
 *   hasMore: true,
 * };
 * ```
 */
export interface PaginatedResult<T> {
  /**
   * Array of entities for the current page
   */
  data: T[];

  /**
   * Total number of entities across all pages
   */
  total: number;

  /**
   * Current page number (1-indexed)
   */
  page: number;

  /**
   * Number of entities per page
   */
  pageSize: number;

  /**
   * Whether there are more pages available
   */
  hasMore?: boolean;
}

/**
 * Helper to create paginated results
 */
export const createPaginatedResult = <T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number
): PaginatedResult<T> => ({
  data,
  total,
  page,
  pageSize,
  hasMore: page * pageSize < total,
});
