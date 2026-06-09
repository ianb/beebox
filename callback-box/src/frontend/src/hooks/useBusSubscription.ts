/**
 * Subscribe to the box's global event stream over the tRPC WebSocket.
 *
 * The replacement for `useSSE`: same `{event, data}` payloads, but multiplexed
 * over the one shared WebSocket instead of a dedicated EventSource. Reconnect
 * and missed-event replay (via `lastEventId`/the bus `afterId` cursor) are
 * handled by `wsLink` + the `events.subscribe` procedure, so callers no longer
 * manage connection state, visibility pausing, or per-tab connection rationing.
 *
 * `onConnect` fires when the subscription (re)starts — callers use it to force a
 * full resync (the chat FSM's REFRESH), a belt over the automatic replay for
 * gaps that exceed the bus retention window.
 */

import { useEffect, useRef, useCallback } from "react";
import { trpc } from "../lib/trpc";

/** A real-time event delivered to subscribers. */
export interface RealtimeEvent {
  event: string;
  data?: unknown;
}

/**
 * tRPC delivers `tracked()` events as a raw `{ id, data }` envelope and plain
 * (transient) events as the payload directly, so onData sees a union. Unwrap to
 * the payload either way; the id is internal (wsLink tracks it for resume).
 */
type WireEvent = RealtimeEvent | { id: string; data: RealtimeEvent };

function unwrap(wire: WireEvent): RealtimeEvent {
  return "event" in wire ? wire : wire.data;
}

export interface UseBusSubscriptionOptions {
  onEvent: (event: RealtimeEvent) => void;
  onConnect?: () => void;
}

export function useBusSubscription(options: UseBusSubscriptionOptions): { connected: boolean } {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const sub = trpc.events.subscribe.useSubscription(undefined, {
    onStarted: useCallback(() => {
      optionsRef.current.onConnect?.();
    }, []),
    onData: useCallback((data: WireEvent) => {
      optionsRef.current.onEvent(unwrap(data));
    }, []),
    onError: useCallback((err: { message: string }) => {
      // wsLink retries the connection itself; surface for debugging only.
      console.warn(`[events-sub] ${err.message}`);
    }, []),
  });

  return { connected: sub.status === "pending" };
}
