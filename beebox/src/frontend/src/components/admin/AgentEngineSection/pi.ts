/**
 * What the admin engine section says about pi. pi runs only models added under
 * OpenRouter models, with the box's `openrouter` key, so it can be chosen only
 * once both exist (docs/implemented-plans/pi-box-engine.md, Track 7). The checks follow
 * `piReadiness` (core/agent/readiness.ts): the default model, then the key.
 */

import type { AddedModel } from "@shared/chat-models.js";

export interface PiSetup {
  added: readonly AddedModel[];
  keyGranted: boolean;
  /** The box's default model when pi is already the default engine; omitted otherwise. */
  piDefault?: string | null;
}

/** What the box lacks to run pi, in plain words, or null when pi can run. */
export function piMissing({ added, keyGranted, piDefault }: PiSetup): string | null {
  if (added.length === 0) return "Needs a model added under OpenRouter models.";
  if (piDefault !== undefined && !added.some((m) => m.id === piDefault)) {
    return "Needs a default model chosen from the added OpenRouter models.";
  }
  if (!keyGranted) return "Needs an OpenRouter key, set and granted under Secrets.";
  return null;
}

/** The default model a switch to pi saves with: the current one if it is added, else the first added model. */
export function piDefaultFor(current: string | null, added: readonly AddedModel[]): string | null {
  if (added.some((m) => m.id === current)) return current;
  return added[0]?.id ?? null;
}
