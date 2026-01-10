import { useSSEStream } from "../use-sse-stream";

import type { CacheConfig } from "../../types";

export interface SSEConcatenatorOptions {
  /** The endpoint URL */
  url: string;

  /** Request body (will be JSON stringified) */
  body?: unknown;

  /** Custom headers */
  headers?: Record<string, string>;

  /** Field to extract from parsed message (default: "text") */
  textField?: string;

  /** Cache configuration */
  cache?: CacheConfig<string>;

  /** Whether to enable the stream */
  enabled?: boolean;

  /** Dependencies that trigger stream restart */
  dependencies?: unknown[];

  /** Custom done detector (default: "[DONE]") */
  isDone?: (data: string) => boolean;
}

/**
 * High-level hook for concatenating text from SSE stream
 *
 * @param options - Configuration options
 * @returns Stream state with concatenated text
 *
 * @example
 * ```typescript
 * const { data, isLoading } = useSSEConcatenator({
 *   url: 'http://localhost:8000/explain-step',
 *   body: { recipeId, stepNumber, instruction },
 *   textField: 'text',
 *   cache: {
 *     queryKey: ['MCP', 'EXPLAIN_STEP', recipeId, stepNumber],
 *     checkCache: true,
 *     saveOnComplete: true
 *   },
 *   dependencies: [recipeId, stepNumber]
 * });
 * ```
 */
export const useSSEConcatenator = (options: SSEConcatenatorOptions) => {
  const {
    url,
    body,
    headers,
    textField = "text",
    cache,
    enabled = true,
    dependencies = [],
    isDone = (data) => data === "[DONE]",
  } = options;

  return useSSEStream<string, string>({
    config: {
      url,
      method: "POST",
      headers,
      body,
    },
    parseMessage: (event) => {
      try {
        const parsed = JSON.parse(event.data);
        return parsed[textField] ?? null;
      } catch {
        return null;
      }
    },
    accumulate: (state, text) => state + text,
    initialState: "",
    isDone: (event) => isDone(event.data),
    cache,
    enabled,
    dependencies,
  });
};
