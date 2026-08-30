/**
 * A chat's model state, resolved.
 *
 * A `ChatSession` holds two model values and they mean different things. The
 * **explicit** model is the chat's own choice, persisted in its model file;
 * `null` there means the chat *follows* the box default rather than meaning
 * "no model". The **resolved** model is what the live subprocess is actually
 * running, fixed at the moment that subprocess started.
 *
 * Keeping them apart is what lets a pin change the box default without
 * touching a conversation in progress: the follower keeps its resolved model
 * until it next starts cold, and only then reads the default again.
 */

import { loadBoxModel, type AgentEngine } from "../../box/config.js";
import { resolveEffectiveModel, type ResolvedModel } from "../../model-policy.js";

/** Resolve a chat's effective model from its own choice and the box policy. */
export async function resolveSessionModel(
  boxRoot: string,
  { engine, explicit }: { engine: AgentEngine; explicit: string | null },
): Promise<ResolvedModel> {
  return resolveEffectiveModel(
    { engine, pinned: await loadBoxModel(boxRoot) },
    explicit === null ? { kind: "follow" } : { kind: "explicit", model: explicit },
  );
}
