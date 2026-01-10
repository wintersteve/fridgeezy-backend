/**
 * Creates a stable cache key from parameters
 *
 * @param prefix - Key prefix (e.g., ['MCP', 'SUGGEST_RECIPE'])
 * @param params - Parameters to include in key
 * @returns React Query cache key array
 *
 * @example
 * ```typescript
 * const key = createCacheKey(
 *   ['MCP', 'SUGGEST_RECIPE'],
 *   { ingredients: ['tomato', 'cheese'] }
 * );
 * // Result: ['MCP', 'SUGGEST_RECIPE', 'ingredients:cheese,tomato']
 * ```
 */
export const createCacheKey = (
  prefix: unknown[],
  params: Record<string, unknown>,
): unknown[] => {
  const sortedEntries = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return `${key}:${value.slice().sort().join(",")}`;
      }
      return `${key}:${value}`;
    });

  return [...prefix, sortedEntries.join("|")];
};
