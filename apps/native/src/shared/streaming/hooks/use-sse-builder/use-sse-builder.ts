import { useSSEStream } from "../use-sse-stream";

import type { CacheConfig } from "../../types";

export interface MessageWithType {
  type: string;
  [key: string]: unknown;
}

export interface SSEBuilderOptions<T> {
  /** The endpoint URL */
  url: string;

  /** Request body (will be JSON stringified) */
  body?: unknown;

  /** Custom headers */
  headers?: Record<string, string>;

  /** Initial object state */
  initialState: T;

  /** Message handler - receives type and parsed message, returns updated state */
  onMessage: (currentState: T, message: MessageWithType) => T;

  /** Cache configuration */
  cache?: CacheConfig<T>;

  /** Whether to enable the stream */
  enabled?: boolean;

  /** Dependencies that trigger stream restart */
  dependencies?: unknown[];

  /** Custom done detector (default checks for type="complete" or data="[DONE]") */
  isDone?: (message: MessageWithType | string) => boolean;
}

/**
 * High-level hook for building an object from SSE stream messages
 *
 * Useful for type-based message handling where different message types
 * update different parts of the object.
 *
 * @param options - Configuration options
 * @returns Stream state with built object
 *
 * @example
 * ```typescript
 * const { data, isLoading } = useSSEBuilder<Recipe>({
 *   url: 'http://localhost:8000/recipe',
 *   body: { title, ingredients },
 *   initialState: {
 *     name: '',
 *     ingredients: [],
 *     instructions: [],
 *   },
 *   onMessage: (state, message) => {
 *     switch (message.type) {
 *       case 'header':
 *         return { ...state, name: message.name, description: message.description };
 *       case 'ingredient':
 *         return { ...state, ingredients: [...state.ingredients, message] };
 *       case 'instruction':
 *         return { ...state, instructions: [...state.instructions, message.text] };
 *       default:
 *         return state;
 *     }
 *   },
 *   cache: {
 *     queryKey: ['MCP', 'GENERATE_RECIPE', cacheKey],
 *     checkCache: true,
 *     saveOnComplete: true
 *   },
 *   dependencies: [cacheKey]
 * });
 * ```
 */
export const useSSEBuilder = <T extends Record<string, unknown>>(
  options: SSEBuilderOptions<T>,
) => {
  const {
    url,
    body,
    headers,
    initialState,
    onMessage,
    cache,
    enabled = true,
    dependencies = [],
    isDone = (message) => {
      if (typeof message === "string") return message === "[DONE]";
      return message.type === "complete";
    },
  } = options;

  return useSSEStream<T, MessageWithType>({
    config: {
      url,
      method: "POST",
      headers,
      body,
    },
    parseMessage: (event) => {
      if (event.data === "[DONE]") return null;
      return JSON.parse(event.data) as MessageWithType;
    },
    accumulate: (state, message) => onMessage(state, message),
    initialState,
    isDone: (event) => {
      if (event.data === "[DONE]") return true;
      try {
        const message = JSON.parse(event.data) as MessageWithType;
        return isDone(message);
      } catch {
        return false;
      }
    },
    cache,
    enabled,
    dependencies,
  });
};
