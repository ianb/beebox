import type { SendBinding } from "@shared/chat-composer-binding.js";

/** Applied last at both POST sites: mutable machine state cannot retarget a send. */
export function boundTurnFields(binding: SendBinding | undefined) {
  if (binding === undefined) return {};
  const { target, attention } = binding;
  if (target.kind === "session") {
    return { session: target.sessionId, exactSession: true, viewContext: attention };
  }
  return {
    session: "new", exactSession: false, contextDir: target.contextDir,
    engine: target.engine, ...(target.model !== undefined ? { model: target.model } : {}),
    ...(target.seedFeatures !== undefined ? { seedFeatures: target.seedFeatures } : {}),
    viewContext: attention,
  };
}
