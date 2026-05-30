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

export function useSSE(url: string, optionsArg?: UseSSEOptions): UseSSEReturn {
  const options = optionsArg ?? {};
  const input = useMemo(() => ({ url }), [url]);
  const [snapshot, send] = useSSRMachine(sseMachine, { input });

  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

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
