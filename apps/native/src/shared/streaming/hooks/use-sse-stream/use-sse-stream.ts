import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import EventSource from "react-native-sse";

import { createSSEClient } from "../../utils/create-sse-client";

import type { SSEStreamOptions, SSEStreamResult } from "../../types";

/**
 * Low-level SSE streaming hook with React Query integration
 *
 * This is the foundation for all higher-level streaming hooks.
 * Handles EventSource lifecycle, state management, caching, and cleanup.
 *
 * @param options - Stream configuration options
 * @returns Stream state and control functions
 *
 * @example
 * ```typescript
 * const { data, isLoading, cancel, refetch } = useSSEStream({
 *   config: {
 *     url: 'http://localhost:8000/suggestions',
 *     method: 'POST',
 *     body: { ingredients }
 *   },
 *   parseMessage: (event) => JSON.parse(event.data),
 *   accumulate: (state, message) => [...state, message],
 *   initialState: [],
 *   cache: {
 *     queryKey: ['suggestions', ingredientsKey],
 *     checkCache: true,
 *     saveOnComplete: true
 *   },
 *   dependencies: [ingredientsKey]
 * });
 * ```
 */
export const useSSEStream = <TState, TMessage = unknown>(
  options: SSEStreamOptions<TState, TMessage>,
): SSEStreamResult<TState> => {
  const {
    config,
    parseMessage,
    accumulate,
    initialState,
    isDone = (event) => event.data === "[DONE]",
    cache,
    enabled = true,
    dependencies = [],
  } = options;

  const queryClient = useQueryClient();

  const [data, setData] = useState<TState>(initialState);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const stateRef = useRef<TState>(initialState);
  const configRef = useRef(config);
  const parseMessageRef = useRef(parseMessage);
  const accumulateRef = useRef(accumulate);
  const isDoneRef = useRef(isDone);
  const initialStateRef = useRef(initialState);
  const cacheRef = useRef(cache);

  // Keep refs in sync
  configRef.current = config;
  parseMessageRef.current = parseMessage;
  accumulateRef.current = accumulate;
  isDoneRef.current = isDone;
  initialStateRef.current = initialState;
  cacheRef.current = cache;

  // Dependency key for effect
  const depsKey = JSON.stringify(dependencies);

  useEffect(() => {
    if (!enabled) return;

    // Check cache first if configured
    if (cacheRef.current?.checkCache) {
      const cached = queryClient.getQueryData<TState>(
        cacheRef.current.queryKey,
      );
      const isValid = cacheRef.current.isCacheValid
        ? cacheRef.current.isCacheValid(cached)
        : !!cached;

      if (isValid && cached) {
        setData(cached);
        stateRef.current = cached;
        return;
      }
    }

    // Close any existing connection
    eventSourceRef.current?.close();

    // Reset state
    stateRef.current = initialStateRef.current;
    setData(initialStateRef.current);
    setError(null);
    setIsLoading(true);

    // Create SSE client
    const client = createSSEClient(configRef.current);
    eventSourceRef.current = client.getEventSource();

    // Handle messages
    client.onMessage((event) => {
      // Check if done
      if (isDoneRef.current(event)) {
        setIsLoading(false);

        // Save to cache if configured
        if (cacheRef.current?.saveOnComplete) {
          queryClient.setQueryData(cacheRef.current.queryKey, stateRef.current);
        }

        client.close();
        return;
      }

      // Parse message
      try {
        const parsed = parseMessageRef.current(event);

        // Skip if parser returns null
        if (parsed === null) return;

        // Accumulate state
        const nextState = accumulateRef.current(stateRef.current, parsed);
        stateRef.current = nextState;
        setData(nextState);
      } catch (err) {
        // Skip malformed messages (following existing pattern)
        console.warn("Failed to parse SSE message:", err);
      }
    });

    // Handle errors
    client.onError((err) => {
      setError(err);
      setIsLoading(false);
      client.close();
    });

    // Cleanup on unmount
    return () => {
      client.close();
    };
  }, [depsKey, enabled, queryClient]);

  const cancel = useCallback(() => {
    eventSourceRef.current?.close();
    setIsLoading(false);
  }, []);

  const refetch = useCallback(() => {
    if (cacheRef.current) {
      queryClient.removeQueries({ queryKey: cacheRef.current.queryKey });
    }

    stateRef.current = initialStateRef.current;
    setData(initialStateRef.current);
    setError(null);

    // Force re-run by closing and clearing ref
    setIsLoading((prev) => {
      if (!prev) {
        setTimeout(() => {
          eventSourceRef.current?.close();
          eventSourceRef.current = null;
        }, 0);
      }
      return prev;
    });
  }, [queryClient]);

  return {
    data,
    isLoading,
    error,
    cancel,
    refetch,
    eventSource: eventSourceRef.current,
  };
};
