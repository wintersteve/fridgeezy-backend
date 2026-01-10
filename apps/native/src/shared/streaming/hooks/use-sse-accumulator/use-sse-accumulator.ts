import { useSSEStream } from "../use-sse-stream";

import type { CacheConfig } from "../../types";

export interface SSEAccumulatorOptions<T> {
  /** The endpoint URL */
  url: string;

  /** Request body (will be JSON stringified) */
  body?: unknown;

  /** Custom headers */
  headers?: Record<string, string>;

  /** Cache configuration */
  cache?: CacheConfig<T[]>;

  /** Whether to enable the stream */
  enabled?: boolean;

  /** Dependencies that trigger stream restart */
  dependencies?: unknown[];

  /** Custom done detector (default: "[DONE]") */
  isDone?: (data: string) => boolean;

  /** Custom message parser (default: JSON.parse) */
  parseMessage?: (data: string) => T | null;
}

/**
 * High-level hook for accumulating array of items from SSE stream
 *
 * @param options - Configuration options
 * @returns Stream state with array of accumulated items
 *
 * @example
 * ```typescript
 * const { data, isLoading, cancel } = useSSEAccumulator<Suggestion>({
 *   url: 'http://localhost:8000/suggestions',
 *   body: { ingredients },
 *   cache: {
 *     queryKey: ['MCP', 'SUGGEST_RECIPE', ingredientsKey],
 *     checkCache: true,
 *     saveOnComplete: true,
 *     isCacheValid: (cached) => cached && cached.length > 0
 *   },
 *   dependencies: [ingredientsKey]
 * });
 * ```
 */
export const useSSEAccumulator = <T>(options: SSEAccumulatorOptions<T>) => {
  const {
    url,
    body,
    headers,
    cache,
    enabled = true,
    dependencies = [],
    isDone = (data) => data === "[DONE]",
    parseMessage = (data) => JSON.parse(data) as T,
  } = options;

  return useSSEStream<T[], T>({
    config: {
      url,
      method: "POST",
      headers,
      body,
    },
    parseMessage: (event) => parseMessage(event.data),
    accumulate: (state, item) => [...state, item],
    initialState: [],
    isDone: (event) => isDone(event.data),
    cache,
    enabled,
    dependencies,
  });
};
