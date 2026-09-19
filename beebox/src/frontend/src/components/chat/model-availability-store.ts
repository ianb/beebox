/**
 * Which provider-backed models the box can run right now — the server's answer
 * about the machine secret store and the owner's added OpenRouter models,
 * published by the model-state hook (`use-chat-model.ts`) whenever it reads
 * chat status, and consumed by the model picker and chip labels. Module-level
 * rather than a prop chain: availability is box state, not per-component
 * state, and the picker is five components deep from the hook (same shape as
 * toast-store).
 */

import { useSyncExternalStore } from "react";
import type { AddedModel } from "@shared/chat-models.js";

interface ModelAvailability {
  /** A usable `glm` key exists — gates the picker's GLM rows. */
  glmAvailable: boolean;
  /** Added OpenRouter models, empty when the box has no usable key. */
  addedModels: readonly AddedModel[];
}

let current: ModelAvailability = { glmAvailable: false, addedModels: [] };
const listeners = new Set<() => void>();

function sameAdded(a: readonly AddedModel[], b: readonly AddedModel[]): boolean {
  return a.length === b.length && a.every((m, i) => {
    const other = b.at(i);
    return other !== undefined && m.id === other.id && m.label === other.label;
  });
}

export function setModelAvailability(next: ModelAvailability): void {
  // Keep the old object when nothing changed: `useSyncExternalStore` compares
  // snapshots by identity, and a fresh object per status read re-renders every
  // subscriber for nothing.
  if (next.glmAvailable === current.glmAvailable && sameAdded(next.addedModels, current.addedModels)) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGlmAvailable(): boolean {
  return useSyncExternalStore(subscribe, () => current.glmAvailable);
}

export function useAddedModels(): readonly AddedModel[] {
  return useSyncExternalStore(subscribe, () => current.addedModels);
}

/** True when a model id is a GLM one. Mirrors `providerOf`'s prefix rule in
 * `src/shared/agent-models.ts` — duplicated here because the frontend bundle
 * takes `shared/chat-models.ts` but not that module's `lib/` import. */
export function isGlmModelId(model: string): boolean {
  return model.startsWith("glm-");
}
