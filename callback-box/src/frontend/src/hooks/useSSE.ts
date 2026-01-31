/**
 * React hook for Server-Sent Events subscription.
 */

import { useEffect, useRef, useCallback, useState } from "react";

export interface SSEEvent {
  event: string;
  data: unknown;
}

export interface UseSSEOptions {
  onEvent?: (event: SSEEvent) => void;
  onError?: (error: Event) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export interface UseSSEReturn {
  connected: boolean;
  lastEvent: SSEEvent | null;
  reconnect: () => void;
}

export function useSSE(url: string, options: UseSSEOptions = {}): UseSSEReturn {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  // Store callbacks in refs to avoid reconnection on callback changes
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const connect = useCallback(() => {
    // Clean up any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setConnected(true);
      optionsRef.current.onConnect?.();
    };

    eventSource.onerror = (error) => {
      setConnected(false);
      optionsRef.current.onError?.(error);
      optionsRef.current.onDisconnect?.();

      // Auto-reconnect after 5 seconds
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect();
      }, 5000);
    };

    // Handle specific event types
    const eventTypes = [
      "connected",
      "ping",
      "file-change",
      "wakeup-start",
      "wakeup-complete",
      "question-answered",
      "card-created",
    ];

    for (const eventType of eventTypes) {
      eventSource.addEventListener(eventType, (event) => {
        const sseEvent: SSEEvent = {
          event: eventType,
          data: JSON.parse((event as MessageEvent).data),
        };
        setLastEvent(sseEvent);
        optionsRef.current.onEvent?.(sseEvent);
      });
    }
  }, [url]); // Only reconnect when URL changes

  const reconnect = useCallback(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [connect]);

  return { connected, lastEvent, reconnect };
}
