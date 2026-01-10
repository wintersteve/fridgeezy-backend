import EventSource from "react-native-sse";

import type { SSEConfig, SSEMessageEvent } from "../../types";

export interface SSEClient {
  /** Add message event listener */
  onMessage: (handler: (event: SSEMessageEvent) => void) => void;

  /** Add error event listener */
  onError: (handler: (error: Error) => void) => void;

  /** Close the connection */
  close: () => void;

  /** Get the underlying EventSource instance */
  getEventSource: () => EventSource;
}

/**
 * Creates a type-safe SSE client wrapper
 *
 * @param config - SSE connection configuration
 * @returns SSE client with typed event handlers
 *
 * @example
 * ```typescript
 * const client = createSSEClient({
 *   url: 'http://localhost:8000/stream',
 *   method: 'POST',
 *   body: { query: 'test' }
 * });
 *
 * client.onMessage((event) => {
 *   console.log(event.data);
 * });
 *
 * client.onError((error) => {
 *   console.error(error);
 * });
 *
 * // Later...
 * client.close();
 * ```
 */
export const createSSEClient = (config: SSEConfig): SSEClient => {
  const { url, method = "POST", headers = {}, body } = config;

  const eventSource = new EventSource(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  return {
    onMessage: (handler) => {
      eventSource.addEventListener("message", (event) => {
        handler({ data: event.data, type: event.type });
      });
    },

    onError: (handler) => {
      eventSource.addEventListener("error", () => {
        handler(new Error("SSE connection error"));
      });
    },

    close: () => {
      eventSource.close();
    },

    getEventSource: () => eventSource,
  };
};
