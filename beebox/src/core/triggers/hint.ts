/**
 * What a chat turn carries about its triggers: the person-turn count
 * (expiry by `turns`) and the `<triggers armed failed expired/>` snapshot
 * child. `expired` counts activations whose expiry the agent has not been
 * told of; they are marked noticed only once the turn is dispatched, so a
 * failed start carries them again. Both never throw: a trigger problem must
 * not stop a person's message.
 */

import { getBoxTime } from "../../lib/time.js";
import { emitTriggerChanged } from "./events.js";
import { appendTrace } from "./trace.js";
import {
  countPersonTurn as countTurn,
  listActivations,
  readActivationFile,
  updateActivations,
  type Activation,
} from "./activation.js";

/** Count one person turn against the session's activations; an expiry is traced and announced. Never throws. */
export async function countPersonTurn(boxRoot: string, sessionId: string): Promise<void> {
  try {
    const { expired } = await countTurn({ boxRoot, sessionId });
    if (expired.length === 0) return;
    const at = getBoxTime(boxRoot).toISOString();
    for (const a of expired) {
      await appendTrace(boxRoot, { at, session: sessionId, activation: a.id, label: a.label, reason: "turns", entries: 0, records: [], outcome: "expired", error: a.error ?? "reached its turn limit", ms: 0 });
    }
    emitTriggerChanged(boxRoot, sessionId);
  } catch (e) {
    console.warn("[triggers] could not count the person turn:", e);
  }
}

/** The `<triggers armed="N" failed="F" expired="E"/>` child, or "" when all are zero. */
export function renderTriggersHint(activations: readonly Activation[]): string {
  const armed = activations.filter((a) => a.state === "armed").length;
  const failed = activations.filter((a) => a.state === "failed" || a.state === "delivery-failed").length;
  const expired = activations.filter((a) => a.state === "expired" && !a.noticed).length;
  if (armed === 0 && failed === 0 && expired === 0) return "";
  return `<triggers armed="${String(armed)}" failed="${String(failed)}" expired="${String(expired)}"/>`;
}

/**
 * The hint for a turn, and a `noticed` callback to run once the turn is
 * dispatched. Expiry is applied at read, and an expiry found here is
 * written through so the status line's query sees the same state.
 */
export async function triggersHint(boxRoot: string, sessionId: string): Promise<{ element: string; noticed: () => Promise<void> }> {
  const none = { element: "", noticed: (): Promise<void> => Promise.resolve() };
  try {
    const read = await readActivationFile({ boxRoot, sessionId });
    if (read.invalid || read.activations.length === 0) return none;
    const now = getBoxTime(boxRoot);
    const activations = await listActivations({ boxRoot, sessionId }, { now });
    const expiredIds = activations.filter((a) => a.state === "expired" && !a.noticed).map((a) => a.id);
    return {
      element: renderTriggersHint(activations),
      noticed: expiredIds.length === 0 ? none.noticed : () => markExpiredNoticed({ boxRoot, sessionId }, expiredIds),
    };
  } catch (e) {
    console.warn("[triggers] could not compose the triggers hint:", e);
    return none;
  }
}

/** Mark the given expired activations noticed (and persist their expiry), under the lock. */
export async function markExpiredNoticed(who: { boxRoot: string; sessionId: string }, ids: readonly string[]): Promise<void> {
  await updateActivations(who, {
    fn: (activations) => activations.map((a) => (ids.includes(a.id) && a.state === "expired" ? { ...a, noticed: true } : a)),
  });
}
