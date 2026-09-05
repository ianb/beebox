import { useCallback, useEffect, useRef, useState } from "react";
import type { AddSelectionInput } from "../../lib/selection/position";
import {
  createNativeAddSelectionCommand,
  nativeComposerCommandAcknowledgementFromDetail,
  postNativeComposerCommand,
  type NativeComposerCommandAcknowledgement,
} from "./native-composer-command";

const ACK_EVENT = "beebox:native-composer-command-ack";
const ACK_TIMEOUT_MS = 15_000;

export function useNativeComposerCommands(enabled: boolean): {
  addSelection: (selection: AddSelectionInput) => void;
  error: string | null;
  dismissError: () => void;
} {
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(new Map<string, number>());

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const shell = window;
    const receive = (acknowledgement: NativeComposerCommandAcknowledgement): void => {
      const timeout = pendingRef.current.get(acknowledgement.id);
      if (timeout === undefined) {
        return;
      }
      window.clearTimeout(timeout);
      pendingRef.current.delete(acknowledgement.id);
      if (!acknowledgement.accepted) {
        setError(acknowledgement.reason);
      }
    };
    const drain = (): void => {
      const queue = shell.beeboxNativeComposerCommandAckQueue ?? [];
      shell.beeboxNativeComposerCommandAckQueue = [];
      for (const detail of queue) {
        const acknowledgement = nativeComposerCommandAcknowledgementFromDetail(detail);
        if (acknowledgement !== null) {
          receive(acknowledgement);
        }
      }
    };
    window.addEventListener(ACK_EVENT, drain);
    drain();
    const pending = pendingRef.current;
    return () => {
      window.removeEventListener(ACK_EVENT, drain);
      for (const timeout of pending.values()) {
        window.clearTimeout(timeout);
      }
      pending.clear();
    };
  }, [enabled]);

  const addSelection = useCallback((selection: AddSelectionInput): void => {
    const id = crypto.randomUUID();
    setError(null);
    const timeout = window.setTimeout(() => {
      pendingRef.current.delete(id);
      setError("The native composer did not confirm the selection. Add it again.");
    }, ACK_TIMEOUT_MS);
    pendingRef.current.set(id, timeout);
    postNativeComposerCommand(window, createNativeAddSelectionCommand(id, selection));
  }, []);

  const dismissError = useCallback((): void => {
    setError(null);
  }, []);

  return { addSelection, error, dismissError };
}
