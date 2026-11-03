/**
 * Wake a chat whose run was interrupted while background tasks were live, so
 * the agent decides about its unfinished work without waiting for the person
 * (docs/implemented-plans/interrupted-chat-wake.md). The turn goes the way a chat check-in
 * does (`./schedule-fire.ts`); the `<run-ended>` note rides in its snapshot.
 */
import { claimWake, wakeAllowed, wakeCandidates, type WakeCandidate } from "../../../core/chat/session/interrupted-wake.js";
import { resolveSessionAvailability } from "../../../core/chat/session/availability.js";
import { loadActiveChats } from "../../../core/schedule/state.js";
import { boxMaintenanceStatus } from "../../../lib/box-maintenance/admission.js";
import { errorMessage } from "../../../shared/error-guards.js";
import { sendFiredTurn, type ScheduleFireDeps } from "./schedule-fire.js";

/** Shutdown or deletion began while the wake waited for admission; the turn is abandoned. */
class WakeCancelledError extends Error {
  constructor(readonly sessionId: string) {
    super("Interrupted-chat wake cancelled");
    this.name = "WakeCancelledError";
  }
}

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

interface WakeState {
  /** Sessions with a wake in progress; a pass skips them. */
  readonly inFlight: Set<string>;
  readonly retryAt: Map<string, number>;
  stopped: boolean;
}

async function wakeOne(deps: ScheduleFireDeps, { candidate, state }: { candidate: WakeCandidate; state: WakeState }): Promise<"sent" | "skipped" | "failed"> {
  const { boxRoot, registry, eventBus, wireSession } = deps;
  const { sessionId } = candidate;
  if (registry.deletion.isBlocked(sessionId)) return "skipped";
  if (registry.get(sessionId)?.isBusy() === true) return "skipped"; // the person's turn will carry the note
  const now = new Date();
  const availability = await resolveSessionAvailability({ boxRoot, sessionId, registry });
  // A chat that cannot run, or has no wake left today, keeps its note for the person.
  if (availability.kind === "unavailable" || !wakeAllowed(boxRoot, { sessionId, now })) {
    claimWake(boxRoot, { candidate, now, count: false });
    return "skipped";
  }
  if (state.stopped || registry.deletion.isBlocked(sessionId)) return "skipped";
  const session = registry.getOrCreate(sessionId);
  wireSession(session);
  registry.enforceLiveCap(sessionId);
  registry.touch(sessionId, { subprocessUse: true });
  // Held for the turn, as a person's send is, so the live cap cannot evict it mid-turn.
  const releasePin = registry.pinSession(session);
  // Rechecked once the send holds the turn: shutdown or deletion may have begun during its awaits.
  const stillWanted = (): void => { if (state.stopped || registry.deletion.isBlocked(sessionId)) throw new WakeCancelledError(sessionId); };
  console.log(`[interrupted-wake] Waking ${sessionId}`);
  try {
    const outcome = await sendFiredTurn({ session, eventBus, firedMessage: wakeMessage(now), checks: {
      onAdmitted: stillWanted,
      onDispatch: () => {
        stillWanted();
        // Claimed at dispatch, so a refused start leaves the note eligible; unrecorded, the wake is not sent.
        if (!claimWake(boxRoot, { candidate, now: new Date(), count: true })) throw new WakeNotRecordedError(sessionId);
      },
    } });
    return outcome === "delivered" ? "sent" : "failed";
  } finally { releasePin(); }
}

/** One pass over this box's run-ended notes; each wake runs on its own, so one slow turn does not hold up another chat's. */
export function createInterruptedWakePass(deps: ScheduleFireDeps): { pass: () => Promise<void>; stop: () => void; whenIdle: () => Promise<unknown> } {
  const state: WakeState = { inFlight: new Set(), retryAt: new Map(), stopped: false };
  const running = new Set<Promise<void>>();
  // A getter: `stopped` changes across the pass's awaits.
  const stopped = (): boolean => state.stopped;
  let scanning = false;
  const pass = async (): Promise<void> => {
    if (scanning || stopped()) return;
    scanning = true;
    try {
      // Maintenance closes the box; its end is the moment a deploy's notes become wakeable.
      if ((await boxMaintenanceStatus(deps.boxRoot))?.owner) return;
      const live = new Set([...(await loadActiveChats(deps.boxRoot)).values()].map((lock) => lock.sessionId));
      for (const candidate of wakeCandidates(deps.boxRoot)) {
        const { sessionId } = candidate;
        // An unstamped record whose run still holds its chat-active lock is a live run, not a crash.
        if (stopped() || state.inFlight.has(sessionId) || (candidate.unstamped && live.has(sessionId))) continue;
        if ((state.retryAt.get(sessionId) ?? 0) > Date.now()) continue;
        state.inFlight.add(sessionId);
        const wake = wakeOne(deps, { candidate, state })
          .then((outcome) => { if (outcome === "failed") state.retryAt.set(sessionId, Date.now() + RETRY_MS); })
          .catch((error: unknown) => { console.error(`[interrupted-wake] Wake of ${sessionId} failed: ${errorMessage(error)}`); state.retryAt.set(sessionId, Date.now() + RETRY_MS); })
          .finally(() => { state.inFlight.delete(sessionId); running.delete(wake); });
        running.add(wake);
      }
    } catch (error) {
      console.error(`[interrupted-wake] Pass failed: ${errorMessage(error)}`);
    } finally { scanning = false; }
  };
  return { pass, stop: () => { state.stopped = true; }, whenIdle: () => Promise.allSettled([...running]) };
}

/** Poll this box's run-ended notes and wake interrupted chats. Returns the stop function. */
export function startInterruptedWakes(deps: ScheduleFireDeps): () => void {
  const { pass, stop } = createInterruptedWakePass(deps);
  const first = setTimeout(() => { void pass(); }, FIRST_PASS_MS);
  const timer = setInterval(() => { void pass(); }, PASS_MS);
  first.unref(); timer.unref();
  return () => { stop(); clearTimeout(first); clearInterval(timer); };
}
