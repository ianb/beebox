/**
 * React hook for Server-Sent Events subscription via XState.
 */

import { useEffect, useRef, useCallback, useMemo } from "react";
import { useSSRMachine } from "./useSSRMachine";
import { sseMachine, type SSEEvent } from "../machines/sseMachine";

export type { SSEEvent };

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

/**
 * How long a tab stays hidden before we drop its /events connection. The dev
 * router serves every worktree/box/tab over one origin, and HTTP/1.1 caps the
 * browser at ~6 concurrent connections per origin — each open tab's long-lived
 * SSE permanently eats one slot, so a handful of backgrounded tabs can exhaust
 * the pool and wedge new requests. Pausing hidden tabs frees their slot. The
 * grace delay keeps a quick alt-tab from thrashing the connection.
 */
const HIDE_GRACE_MS = 20_000;

export function useSSE(url: string, optionsArg?: UseSSEOptions): UseSSEReturn {
  const options = optionsArg ?? {};
  const input = useMemo(() => ({ url }), [url]);
  const [snapshot, send] = useSSRMachine(sseMachine, { input });

  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  // Pause the connection while the tab is hidden, resume when it returns.
  // On reconnect, useSSE's onConnect resync (e.g. REFRESH in the chat FSM)
  // catches up anything the event bus delivered across the gap. The listener
  // mounts once; send from useSSRMachine is stable, so the grace timer isn't
  // reset by re-renders.
  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hideTimer = setTimeout(() => {
          send({ type: "DISCONNECT" });
        }, HIDE_GRACE_MS);
      } else {
        if (hideTimer !== undefined) {
          clearTimeout(hideTimer);
          hideTimer = undefined;
        }
        // No-op unless we're in the disconnected state; safe to send always.
        send({ type: "RECONNECT" });
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      if (hideTimer !== undefined) clearTimeout(hideTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [send]);

  const connected = snapshot.matches({ active: "connected" });
  const { lastEvent } = snapshot.context;

  // Fire callbacks on state transitions
  const prevConnectedRef = useRef(false);
  useEffect(() => {
    if (connected && !prevConnectedRef.current) {
      optionsRef.current.onConnect?.();
    } else if (!connected && prevConnectedRef.current) {
      optionsRef.current.onDisconnect?.();
    }
    prevConnectedRef.current = connected;
  }, [connected]);

  // Fire onEvent when lastEvent changes
  const prevLastEventRef = useRef(lastEvent);
  useEffect(() => {
    if (lastEvent && lastEvent !== prevLastEventRef.current) {
      optionsRef.current.onEvent?.(lastEvent);
    }
    prevLastEventRef.current = lastEvent;
  }, [lastEvent]);

  const reconnect = useCallback(() => {
    send({ type: "RECONNECT" });
  }, [send]);

  return { connected, lastEvent, reconnect };
}
