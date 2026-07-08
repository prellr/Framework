import { useEffect, useRef } from "react";

type SSEHandler = (event: MessageEvent) => void;

/**
 * Subscribe to the app SSE stream (/api/sse).
 * Automatically reconnects on error with exponential back-off.
 */
export function useSSE(handlers: Record<string, SSEHandler>, enabled = true) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) return;

    let es: EventSource | null = null;
    let retryDelay = 1_000;
    let destroyed = false;

    const connect = () => {
      if (destroyed) return;
      es = new EventSource("/api/sse", { withCredentials: true });

      es.addEventListener("open", () => {
        retryDelay = 1_000; // reset back-off on successful connect
      });

      // Attach named event handlers
      const currentHandlers = handlersRef.current;
      for (const [event, handler] of Object.entries(currentHandlers)) {
        es.addEventListener(event, handler);
      }

      es.addEventListener("error", () => {
        es?.close();
        if (!destroyed) {
          setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 30_000);
        }
      });
    };

    connect();

    return () => {
      destroyed = true;
      es?.close();
    };
  }, [enabled]);
}
