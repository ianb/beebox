/**
 * The two things a ChatSession does differently when its id was *coined* —
 * reserved before the conversation existed (`reserve.ts`) rather than assigned
 * by the harness mid-run.
 *
 * Split from `index.ts` for that file's line budget.
 */

import { makeLog } from "./log.js";
import { errorMessage } from "../../../lib/error-guards.js";
import { transcriptExistsForContext } from "./transcript-paths.js";
import type { ChatSessionOptions } from "./options.js";

const log = makeLog("ChatSession");

/**
 * Whether this run must still *create* the conversation under the coined id.
 *
 * Re-checked against the transcript at each run start rather than latched on
 * the first: a run that fails before writing anything must still be able to
 * create the conversation, and a run after one that succeeded must resume it
 * instead — the harness rejects an id whose transcript already exists.
 */
async function coinedRunStillPending(opts: {
  boxRoot: string;
  sessionId: string;
  contextDir: string | null;
}): Promise<boolean> {
  return !(await transcriptExistsForContext(opts.boxRoot, {
    sessionId: opts.sessionId,
    contextDir: opts.contextDir,
  }));
}

/**
 * Fire the coined session's stand-in for assignment. A coined session never
 * fires `onSessionIdAssigned` — `captureAssignedSessionId` returns early once
 * the session knows its id — so the bookkeeping that assignment normally
 * triggers is driven from the first run that creates the conversation.
 *
 * Fire-and-forget with its own logging: bookkeeping must not block the turn.
 */
function fireFirstRunStart(opts: { sessionId: string; options: ChatSessionOptions }): void {
  const onFirstRunStart = opts.options.onFirstRunStart;
  if (onFirstRunStart === undefined) return;
  void Promise.resolve(onFirstRunStart(opts.sessionId)).catch((e: unknown) => {
    log("start", `onFirstRunStart(${opts.sessionId}) failed: ${errorMessage(e)}`);
  });
}

/**
 * A ChatSession's coined-id state, kept out of the session itself: whether the
 * next run creates the conversation, and the one-time first-run bookkeeping.
 * Inert (`pending` always false) for a session whose id came from the harness.
 */
export interface CoinedRunState {
  readonly pending: boolean;
  refresh(opts: { boxRoot: string; sessionId: string | null; contextDir: string | null }): Promise<void>;
  noteRunStarted(sessionId: string | null, options: ChatSessionOptions): void;
}

export function createCoinedRunState(options: ChatSessionOptions): CoinedRunState {
  let pending = options.coinedSessionId !== undefined;
  let recorded = false;
  return {
    get pending(): boolean {
      return pending;
    },
    async refresh(opts): Promise<void> {
      if (!pending || opts.sessionId === null) return;
      pending = await coinedRunStillPending({
        boxRoot: opts.boxRoot,
        sessionId: opts.sessionId,
        contextDir: opts.contextDir,
      });
    },
    noteRunStarted(sessionId, sessionOptions): void {
      if (recorded || !pending || sessionId === null) return;
      recorded = true;
      fireFirstRunStart({ sessionId, options: sessionOptions });
    },
  };
}
