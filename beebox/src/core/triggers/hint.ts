/**
 * What a chat turn carries about its triggers: the person-turn count
 * (expiry by `turns`) and the `<triggers armed failed expired done/>`
 * snapshot child. `expired` and `done` count endings the agent has not been
 * told of (a fire that ended its activation told it already; a quiet end did
 * not); they are marked noticed only once the turn is dispatched, so a
 * failed start carries them again. Both never throw: a trigger problem must
 * not stop a person's message.
 */

import { getBoxTime } from "../../lib/time.js";
import {
  countPersonTurn as countTurn,
  listActivations,
  readActivationFile,
  updateActivations,
  type Activation,
} from "./activation.js";

/** Count one person turn against the session's activations; the store traces and announces an expiry. Never throws. */
export async function countPersonTurn(boxRoot: string, sessionId: string): Promise<void> {
  try {
    await countTurn({ boxRoot, sessionId });
  } catch (e) {
    console.warn("[triggers] could not count the person turn:", e);
  }
}

/** An ending the agent has not been told of: an expiry, or a quiet `done`. */
function unnoticedEnd(a: Activation): boolean {
  return (a.state === "expired" || a.state === "done") && !a.noticed;
}

/** The `<triggers armed="N" failed="F" expired="E" done="D"/>` child, or "" when all are zero. */
export function renderTriggersHint(activations: readonly Activation[]): string {
  const armed = activations.filter((a) => a.state === "armed").length;
  const failed = activations.filter((a) => a.state === "failed" || a.state === "delivery-failed").length;
  const expired = activations.filter((a) => a.state === "expired" && !a.noticed).length;
  const done = activations.filter((a) => a.state === "done" && !a.noticed).length;
  if (armed === 0 && failed === 0 && expired === 0 && done === 0) return "";
  return `<triggers armed="${String(armed)}" failed="${String(failed)}" expired="${String(expired)}" done="${String(done)}"/>`;
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
    const endedIds = activations.filter(unnoticedEnd).map((a) => a.id);
    return {
      element: renderTriggersHint(activations),
      noticed: endedIds.length === 0 ? none.noticed : () => markExpiredNoticed({ boxRoot, sessionId }, endedIds),
    };
  } catch (e) {
    console.warn("[triggers] could not compose the triggers hint:", e);
    return none;
  }
}

/** Mark the given ended activations noticed (and persist their expiry), under the lock. */
export async function markExpiredNoticed(who: { boxRoot: string; sessionId: string }, ids: readonly string[]): Promise<void> {
  await updateActivations(who, {
    fn: (activations) => activations.map((a) => (ids.includes(a.id) && (a.state === "expired" || a.state === "done") ? { ...a, noticed: true } : a)),
  });
}
