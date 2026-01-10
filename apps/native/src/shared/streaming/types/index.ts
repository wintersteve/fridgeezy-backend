import type EventSource from "react-native-sse";

/**
 * Configuration for SSE connection
 */
export interface SSEConfig {
  /** The endpoint URL */
  url: string;
  /** HTTP method (typically POST) */
  method?: "GET" | "POST";
  /** Request headers */
  headers?: Record<string, string>;
  /** Request body (will be JSON stringified) */
  body?: unknown;
}

/**
 * Message event from EventSource
 */
export interface SSEMessageEvent {
  /** The data payload from the event */
  data: string;
  /** Event type (optional) */
  type?: string;
}

/**
 * Message parser function
 * @param event - The SSE message event
 * @returns Parsed data or null to skip
 */
export type MessageParser<T> = (event: SSEMessageEvent) => T | null;

/**
 * State accumulator function
 * @param currentState - Current accumulated state
 * @param newData - New data from parsed message
 * @returns Updated state
 */
export type StateAccumulator<TState, TMessage> = (
  currentState: TState,
  newData: TMessage,
) => TState;

/**
 * Done detector function
 * @param event - The SSE message event
 * @returns true if stream is complete
 */
export type DoneDetector = (event: SSEMessageEvent) => boolean;

/**
 * Cache configuration for React Query integration
 */
export interface CacheConfig<T> {
  /** React Query key */
  queryKey: unknown[];
  /** Whether to check cache before streaming */
  checkCache?: boolean;
  /** Whether to save to cache on completion */
  saveOnComplete?: boolean;
  /** Custom cache validator (return true if cache is valid) */
  isCacheValid?: (cached: T | undefined) => boolean;
}

/**
 * Options for SSE streaming
 */
export interface SSEStreamOptions<TState, TMessage> {
  /** SSE connection configuration */
  config: SSEConfig;

  /** Message parser - converts event.data to typed message */
  parseMessage: MessageParser<TMessage>;

  /** State accumulator - updates state with new message */
  accumulate: StateAccumulator<TState, TMessage>;

  /** Initial state value */
  initialState: TState;

  /** Done detector - default checks for "[DONE]" */
  isDone?: DoneDetector;

  /** Cache configuration for React Query */
  cache?: CacheConfig<TState>;

  /** Whether to enable the stream (default: true) */
  enabled?: boolean;

  /** Dependencies that trigger stream restart */
  dependencies?: unknown[];
}

/**
 * Return type for SSE streaming hooks
 */
export interface SSEStreamResult<T> {
  /** The accumulated data */
  data: T;

  /** Whether the stream is currently active */
  isLoading: boolean;

  /** Error if stream failed */
  error: Error | null;

  /** Cancel the current stream */
  cancel: () => void;

  /** Refetch - clear cache and restart stream */
  refetch: () => void;

  /** The EventSource instance (advanced usage) */
  eventSource: EventSource | null;
}
