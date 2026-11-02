/**
 * Wake a chat whose run was interrupted while background tasks were live, so
 * the agent decides about its unfinished work without waiting for the person
 * (docs/plans/interrupted-chat-wake.md). The turn goes the way a chat check-in
 * does (`./schedule-fire.ts`); the `<run-ended>` note rides in its snapshot.
 */
import { claimWake, wakeAllowed, wakeCandidates } from "../../../core/chat/session/interrupted-wake.js";
import { resolveSessionAvailability } from "../../../core/chat/session/availability.js";
import { loadActiveChats } from "../../../core/schedule/state.js";
import { boxMaintenanceStatus } from "../../../lib/box-maintenance/admission.js";
import { errorMessage } from "../../../shared/error-guards.js";
import { sendFiredTurn, type ScheduleFireDeps } from "./schedule-fire.js";

/** The wake's claim could not be written; the turn is abandoned so an unrecorded wake cannot repeat. */
class WakeNotRecordedError extends Error {
  constructor(readonly sessionId: string) {
    super("Interrupted-chat wake could not be recorded");
    this.name = "WakeNotRecordedError";
  }
}

const FIRST_PASS_MS = 5_000;
const PASS_MS = 30_000;
/** After a wake that did not go out, wait this long before trying that chat again. */
const RETRY_MS = 10 * 60_000;

function wakeMessage(now: Date): string {
  return `<interrupted-wake at="${now.toISOString()}">The Bee Box started this turn by itself: your previous run was interrupted while background tasks were running (see run-ended). Decide whether to restart the unfinished work, drop it, or ask. Your reply is shown to the person, so say in a line or two what happened and what you are doing.</interrupted-wake>`;
}

async function wakeOne(deps: ScheduleFireDeps, sessionId: string): Promise<"sent" | "skipped" | "failed"> {
  const { boxRoot, registry, eventBus, wireSession } = deps;
  if (registry.deletion.isBlocked(sessionId)) return "skipped";
  if (registry.get(sessionId)?.isBusy() === true) return "skipped"; // the person's turn will carry the note
  const now = new Date();
  const availability = await resolveSessionAvailability({ boxRoot, sessionId, registry });
  // A chat that cannot run, or has no wake left today, keeps its note for the person.
  if (availability.kind === "unavailable" || !wakeAllowed(boxRoot, { sessionId, now })) {
    claimWake(boxRoot, { sessionId, now, count: false });
    return "skipped";
  }
  const session = registry.getOrCreate(sessionId);
  wireSession(session);
  registry.enforceLiveCap(sessionId);
  registry.touch(sessionId, { subprocessUse: true });
  console.log(`[interrupted-wake] Waking ${sessionId}`);
  const outcome = await sendFiredTurn({ session, eventBus, firedMessage: wakeMessage(now), onDispatch: () => {
    // Claimed at dispatch, so a refused start leaves the note eligible; unrecorded, the wake is not sent.
    if (!claimWake(boxRoot, { sessionId, now: new Date(), count: true })) throw new WakeNotRecordedError(sessionId);
  } });
  return outcome === "delivered" ? "sent" : "failed";
}

/** One pass over this box's run-ended notes; overlapping calls skip. */
export function createInterruptedWakePass(deps: ScheduleFireDeps): () => Promise<void> {
  const retryAt = new Map<string, number>();
  let running = false;
  return async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      // Maintenance closes the box; its end is the moment a deploy's notes become wakeable.
      if ((await boxMaintenanceStatus(deps.boxRoot))?.owner) return;
      const live = new Set([...(await loadActiveChats(deps.boxRoot)).values()].map((lock) => lock.sessionId));
      for (const { sessionId, unstamped } of wakeCandidates(deps.boxRoot)) {
        // An unstamped record whose run still holds its chat-active lock is a live run, not a crash.
        if (unstamped && live.has(sessionId)) continue;
        if ((retryAt.get(sessionId) ?? 0) > Date.now()) continue;
        if ((await wakeOne(deps, sessionId)) === "failed") retryAt.set(sessionId, Date.now() + RETRY_MS);
      }
    } catch (error) {
      console.error(`[interrupted-wake] Pass failed: ${errorMessage(error)}`);
    } finally { running = false; }
  };
}

/** Poll this box's run-ended notes and wake interrupted chats. Returns the stop function. */
export function startInterruptedWakes(deps: ScheduleFireDeps): () => void {
  const pass = createInterruptedWakePass(deps);
  const first = setTimeout(() => { void pass(); }, FIRST_PASS_MS);
  const timer = setInterval(() => { void pass(); }, PASS_MS);
  first.unref(); timer.unref();
  return () => { clearTimeout(first); clearInterval(timer); };
}
