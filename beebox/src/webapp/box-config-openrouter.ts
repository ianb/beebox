/**
 * Add and remove the owner's OpenRouter chat models in `_config/box.json`.
 *
 * Adding is the act that lets a box spend per use on a model, so these are the
 * only writers of `openrouterModels` (`docs/plans/openrouter-chat-models.md`).
 * Both run inside the config write lock: the "still the default?" check on
 * removal must see the same file the write replaces.
 */

import { isRecord } from "../lib/is-record.js";
import type { AddedModel } from "../shared/chat-models.js";
import { mutateConfig, type BoxConfigMutationResult } from "./box-config-write.js";

/** Removing the box's default model would leave followers on nothing they chose. */
export class OpenRouterModelInUseError extends Error {
  constructor(readonly id: string) {
    super(`${id} is this box's default model. Change the default model first, then remove it.`);
    this.name = "OpenRouterModelInUseError";
  }
}

/** Entries as stored, untouched — a malformed one is the loader's to report, not ours to delete. */
function storedEntries(config: Record<string, unknown>): unknown[] {
  const raw = config.openrouterModels;
  if (!Array.isArray(raw)) return [];
  const entries: readonly unknown[] = raw;
  return [...entries];
}

function entryId(entry: unknown): unknown {
  return isRecord(entry) ? entry.id : undefined;
}

/** Add a model, or relabel it when the id is already there. The caller validated it. */
export async function addOpenRouterModel(params: { boxRoot: string; model: AddedModel }): Promise<BoxConfigMutationResult> {
  const { model } = params;
  return mutateConfig({
    boxRoot: params.boxRoot,
    message: `Add OpenRouter chat model ${model.id}`,
    mutate(config) {
      const entries = storedEntries(config);
      const at = entries.findIndex((entry) => entryId(entry) === model.id);
      const stored = { id: model.id, label: model.label };
      if (at === -1) entries.push(stored);
      else entries[at] = stored;
      config.openrouterModels = entries;
    },
  });
}

/**
 * Remove a model. Refuses while it is the box default. A chat that picked it
 * explicitly keeps the pick and refuses its next turn — deliberate, see
 * `resolveEffectiveModel`.
 */
export async function removeOpenRouterModel(params: { boxRoot: string; id: string }): Promise<BoxConfigMutationResult> {
  const { id } = params;
  return mutateConfig({
    boxRoot: params.boxRoot,
    message: `Remove OpenRouter chat model ${id}`,
    mutate(config) {
      if (config.agentModel === id) throw new OpenRouterModelInUseError(id);
      const entries = storedEntries(config).filter((entry) => entryId(entry) !== id);
      if (entries.length === 0) delete config.openrouterModels;
      else config.openrouterModels = entries;
    },
  });
}
