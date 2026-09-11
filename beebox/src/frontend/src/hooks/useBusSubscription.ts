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
import { unwrapBusEvent, type WireBusEvent } from "../lib/bus-events";

/** A real-time event delivered to subscribers. */
export interface RealtimeEvent {
  event: string;
  data?: unknown;
}


export interface UseBusSubscriptionOptions {
  onEvent: (event: RealtimeEvent) => void;
  onConnect?: () => void;
  onError?: () => void;
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
    onData: useCallback((data: WireBusEvent) => {
      optionsRef.current.onEvent(unwrapBusEvent(data));
    }, []),
    onError: useCallback((err: { message: string }) => {
      optionsRef.current.onError?.();
      // wsLink retries the connection itself; surface for debugging only.
      console.warn(`[events-sub] ${err.message}`);
    }, []),
  });

  return { connected: sub.status === "pending" };
}
