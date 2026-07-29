/**
 * One chat-review run: discover qualifying sessions, review each unread span,
 * write the result to its husk, and advance the journal.
 *
 * Two things make a run safe to interrupt or repeat:
 *
 * - A **cross-process lock** around the whole run. `withCardLock` only
 *   coordinates within one Node process, so it cannot stop a manual
 *   `cb chat review run` from racing the scheduled one — different PIDs. The
 *   run therefore takes a `lib/file-lock.ts` lock, per code-style.md's rule
 *   that all cross-process locks go through it.
 * - **Husk first, journal second**, with the applied span id recorded on the
 *   husk. A crash between the two writes leaves the account already extended
 *   and the journal behind; the next run recomputes the same span id, sees it
 *   on the husk, and just advances the journal instead of asking the model to
 *   fold the same material in twice.
 *
 * See docs/plans/chat-review.md § Track C.
 */

import * as path from "node:path";
import { acquireLock, releaseLock, LockHeldError } from "../../../lib/file-lock.js";
import { elideMiddle, MAX_RENDERED_CHARS, renderEntries } from "../transcript-render.js";
import { discoverSessions, QUIESCENCE_MS, type QualifiedSession } from "./discovery.js";
import { appliedSpanFor, computeSpanId, prefixHash } from "./span.js";
import { applyReviewToHusk, readHuskFields } from "./husk-write.js";
import type { ChatReviewer } from "./reviewer.js";
import {
  loadReviewState,
  METADATA_CONSUMER,
  saveReviewState,
  sessionState,
  type ReviewState,
} from "./state.js";

const LOCK_FILE = ".callback-box/chat-review/run.lock";

export interface RunOptions {
  reviewer: ChatReviewer;
  maxSessions: number;
  now: Date;
  /** Box owner's email — never counted as a leak when it appears. */
  ownerEmail: string | null;
}

export interface RunSummary {
  /** Sessions whose reviewer pass completed and were written. */
  reviewed: number;
  /** Sessions already carrying this span id — re-applied nothing, journal advanced. */
  alreadyApplied: number;
  /** Sessions read from the top because the journal could not be continued. */
  bootstrapped: number;
  /** Sessions whose transcript was rewritten under us. */
  rewritten: number;
  reviewerFailures: number;
  /** Generated fields dropped by the leak scan, as "<session>:<field>". */
  rejected: string[];
  /** Qualified sessions beyond --max-sessions; they wait for the next run. */
  overflow: number;
}

function emptySummary(): RunSummary {
  return {
    reviewed: 0,
    alreadyApplied: 0,
    bootstrapped: 0,
    rewritten: 0,
    reviewerFailures: 0,
    rejected: [],
    overflow: 0,
  };
}

/** Record a reviewer failure so a session that keeps failing eventually stops being tried. */
function recordFailure(state: ReviewState, args: { sessionId: string }): void {
  const previous = sessionState(state, args.sessionId);
  state.sessions[args.sessionId] = { ...previous, attempts: previous.attempts + 1 };
}

async function reviewOne(
  session: QualifiedSession,
  args: { boxRoot: string; options: RunOptions; state: ReviewState; summary: RunSummary },
): Promise<void> {
  const { boxRoot, options, state, summary } = args;
  const { span } = session;

  if (span.bootstrap !== null) {
    summary.bootstrapped += 1;
    if (span.bootstrap !== "no-journal") {
      summary.rewritten += 1;
      console.warn(
        `chat-review: transcript for ${session.sessionId} was rewritten (${span.bootstrap}); `
          + "re-reading from the top and keeping the existing account",
      );
    }
  }

  const endEntry = session.entries[span.endIndex];
  if (endEntry === undefined) return; // empty transcript — nothing to fold in
  const spanId = computeSpanId({
    sessionId: session.sessionId,
    endUuid: endEntry.uuid,
    prefixHash: prefixHash(session.entries, span.endIndex),
  });

  const husk = await readHuskFields(boxRoot, session.huskPath);
  const previous = sessionState(state, session.sessionId);

  // Already folded in by a run that died before advancing the journal.
  if (husk.reviewSpan === spanId) {
    summary.alreadyApplied += 1;
    const applied = appliedSpanFor({
      sessionId: session.sessionId,
      entries: session.entries,
      endIndex: span.endIndex,
      now: options.now,
    });
    if (applied !== null) {
      state.sessions[session.sessionId] = {
        ...previous,
        applied: { ...previous.applied, [METADATA_CONSUMER]: applied },
        attempts: 0,
      };
    }
    return;
  }

  let output;
  try {
    output = await options.reviewer.review({
      sessionId: session.sessionId,
      currentTitle: husk.title,
      currentAccount: husk.account,
      span: elideMiddle(renderEntries(span.entries), MAX_RENDERED_CHARS),
      bootstrap: span.bootstrap !== null,
    });
  } catch (e) {
    console.warn(`chat-review: reviewer failed for ${session.sessionId}:`, e);
    recordFailure(state, { sessionId: session.sessionId });
    summary.reviewerFailures += 1;
    return;
  }

  const written = await applyReviewToHusk(boxRoot, {
    relPath: session.huskPath,
    output,
    spanId,
    currentTitle: husk.title,
    storedOwner: previous.titleOwner,
    storedHash: previous.titleHash,
    ownerEmail: options.ownerEmail,
  });
  for (const field of written.rejected) summary.rejected.push(`${session.sessionId}:${field}`);

  const applied = appliedSpanFor({
    sessionId: session.sessionId,
    entries: session.entries,
    endIndex: span.endIndex,
    now: options.now,
  });
  state.sessions[session.sessionId] = {
    ...previous,
    ...(applied !== null ? { applied: { ...previous.applied, [METADATA_CONSUMER]: applied } } : {}),
    titleOwner: written.titleOwner,
    titleHash: written.titleHash,
    attempts: 0,
  };
  summary.reviewed += 1;
}

/**
 * Run the pass. Throws {@link LockHeldError} when another run holds the lock —
 * the caller reports the holder rather than proceeding, since two concurrent
 * runs would each pay for the same model calls and the loser's writes would be
 * thrown away.
 */
export async function runChatReview(boxRoot: string, options: RunOptions): Promise<RunSummary> {
  const lockPath = path.join(boxRoot, LOCK_FILE);
  await acquireLock(lockPath, { holder: "chat-review" });
  try {
    const state = await loadReviewState(boxRoot);
    const discovery = await discoverSessions(boxRoot, {
      now: options.now,
      quiescenceMs: QUIESCENCE_MS,
      state,
    });
    const planned = discovery.qualified.slice(0, options.maxSessions);
    const summary = emptySummary();
    summary.overflow = discovery.qualified.length - planned.length;

    for (const session of planned) {
      await reviewOne(session, { boxRoot, options, state, summary });
    }

    state.lastRunAt = options.now.toISOString();
    await saveReviewState(boxRoot, state);
    return summary;
  } finally {
    await releaseLock(lockPath);
  }
}

export { LockHeldError };
