/**
 * Whether the box can run GLM models right now — the server's answer about
 * the machine secret store, published by the model-state hook
 * (`use-chat-model.ts`) whenever it reads chat status, and consumed by the
 * model picker to hide GLM rows nobody can use. Module-level rather than a
 * prop chain: availability is machine state, not per-component state, and the
 * picker is five components deep from the hook (same shape as toast-store).
 */

import { useSyncExternalStore } from "react";

let available = false;
const listeners = new Set<() => void>();

export function setGlmAvailable(next: boolean): void {
  if (next === available) return;
  available = next;
  for (const listener of listeners) listener();
}

export function useGlmAvailable(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => available,
  );
}

/** True when a model id is a GLM one. Mirrors `providerOf`'s prefix rule in
 * `src/shared/agent-models.ts` — duplicated here because the frontend bundle
 * takes `shared/chat-models.ts` but not that module's `lib/` import. */
export function isGlmModelId(model: string): boolean {
  return model.startsWith("glm-");
}
