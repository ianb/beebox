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
 * See docs/implemented-plans/chat-review.md § Track C.
 */

import * as fs from "node:fs/promises";
import { errnoCode } from "../../../lib/error-guards.js";
import { elideMiddle, MAX_RENDERED_CHARS, renderEntries } from "../transcript-render.js";
import { discoverSessions, QUIESCENCE_MS, readSessionWindow, warnDeferredBoundary, type QualifiedSession } from "./discovery.js";
import { appliedSpanFor, computeSpanId, prefixHash } from "./span.js";
import { applyReviewToHusk, readHuskFields } from "./husk-write.js";
import type { ChatReviewer } from "./reviewer.js";
import { contentHash } from "../../../lib/content-hash.js";
import { resolveTitleOwner } from "./husk-write.js";
import { loadReviewState, MAX_REVIEW_ATTEMPTS, METADATA_CONSUMER, saveReviewState, sessionState, type ReviewState } from "./state.js";
import { LockHeldError, withChatReviewLock } from "./lock.js";

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
  /** Sessions that threw outside the reviewer (unreadable husk, write failure). */
  sessionErrors: number;
  /** Sessions skipped because the same span already failed MAX_REVIEW_ATTEMPTS times. */
  exhausted: number;
  /** Generated fields dropped by the leak scan, as "<session>:<field>". */
  rejected: string[];
  /** Discovery counters, surfaced so a quiet run still says what it saw. */
  missingTranscripts: number;
  deferredActive: number;
  belowThreshold: number;
  /** Qualified sessions beyond --max-sessions; they wait for the next run. */
  overflow: number;
  /**
   * Sessions left untouched because their journal boundary sits past the
   * bounded read window — reviewing them would regress the journal.
   */
  boundaryBeyondWindow: number;
}

function emptySummary(): RunSummary {
  return {
    reviewed: 0,
    alreadyApplied: 0,
    bootstrapped: 0,
    rewritten: 0,
    reviewerFailures: 0,
    sessionErrors: 0,
    exhausted: 0,
    rejected: [],
    missingTranscripts: 0,
    deferredActive: 0,
    belowThreshold: 0,
    overflow: 0,
    boundaryBeyondWindow: 0,
  };
}

/** Record a reviewer failure so a session that keeps failing eventually stops being tried. */
function recordFailure(state: ReviewState, args: { sessionId: string; spanId: string }): void {
  const previous = sessionState(state, args.sessionId);
  state.sessions[args.sessionId] = {
    ...previous,
    attempts: previous.attempts + 1,
    failedSpanId: args.spanId,
  };
}

async function reviewOne(
  session: QualifiedSession,
  args: {
    boxRoot: string;
    options: RunOptions;
    state: ReviewState;
    summary: RunSummary;
  },
): Promise<void> {
  const { boxRoot, options, state, summary } = args;

  // A run spans many model calls, so a session that was quiet at discovery can
  // be live again by the time its turn comes. Discovery's quiescence check no
  // longer covers the material actually reviewed — the transcript is re-read
  // here — so re-check it against the file as it stands now, and defer rather
  // than summarize a conversation back in progress.
  let mtime: Date;
  try {
    mtime = (await fs.stat(session.logPath)).mtime;
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") throw e;
    summary.missingTranscripts += 1;
    return;
  }
  if (options.now.getTime() - mtime.getTime() < QUIESCENCE_MS) {
    summary.deferredActive += 1;
    return;
  }

  // Re-read the transcript here rather than carrying discovery's array on the
  // QualifiedSession: this is the only point where a window has to be resident,
  // and it is one session's worth (see discovery.ts). The span is recomputed
  // from the same journal, so it matches what discovery measured unless the
  // transcript changed underneath — in which case the fresh read is the right
  // one anyway.
  const transcript = await readSessionWindow({
    sessionId: session.sessionId,
    logPath: session.logPath,
    state,
  });
  if (transcript === null) {
    // Vanished between discovery and now. Nothing to fold in; the husk stands.
    summary.missingTranscripts += 1;
    return;
  }
  const { entries, span } = transcript;

  // Unresolvable: the journal boundary is past the read window (the transcript
  // grew past the cap between the last review and now). Bootstrapping here
  // would re-summarize ancient entries AND record a span whose endIndex moves
  // the journal backwards, losing the real boundary for good. Leave the husk
  // and the journal exactly as they are.
  if (span.deferred !== null) {
    warnDeferredBoundary(session.sessionId);
    summary.boundaryBeyondWindow += 1;
    return;
  }

  if (span.bootstrap !== null) {
    summary.bootstrapped += 1;
    if (span.bootstrap !== "no-journal") {
      summary.rewritten += 1;
      console.warn(`chat-review: transcript for ${session.sessionId} was rewritten (${span.bootstrap}); ` + "re-reading from the top and keeping the existing account");
    }
  }

  const endEntry = entries[span.endIndex];
  if (endEntry === undefined) return; // empty transcript — nothing to fold in
  const spanId = computeSpanId({
    sessionId: session.sessionId,
    endUuid: endEntry.uuid,
    prefixHash: prefixHash(entries, span.endIndex),
  });

  const husk = await readHuskFields(boxRoot, session.huskPath);
  const previous = sessionState(state, session.sessionId);

  // Give up only on the span that kept failing. New material is a new span, so
  // a couple of nights of provider trouble can't retire a session for good.
  if (previous.attempts >= MAX_REVIEW_ATTEMPTS && previous.failedSpanId === spanId) {
    summary.exhausted += 1;
    return;
  }

  // Already folded in by a run that died before advancing the journal.
  if (husk.reviewSpan === spanId) {
    summary.alreadyApplied += 1;
    const applied = appliedSpanFor({
      sessionId: session.sessionId,
      entries,
      endIndex: span.endIndex,
      now: options.now,
    });
    if (applied !== null) {
      // Re-derive title provenance as well. Losing the journal must not lose
      // the fact that we wrote the title we are looking at — otherwise the
      // field reverts to "unmanaged" and a later hand edit could be clobbered.
      const owner = resolveTitleOwner({
        currentTitle: husk.title,
        snippetTitle: session.snippetTitle,
        storedOwner: previous.titleOwner,
        storedHash: previous.titleHash,
      });
      state.sessions[session.sessionId] = {
        ...previous,
        applied: { ...previous.applied, [METADATA_CONSUMER]: applied },
        titleOwner: owner,
        titleHash: owner === "generated" && husk.title !== null ? contentHash(husk.title) : previous.titleHash,
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
    recordFailure(state, { sessionId: session.sessionId, spanId });
    summary.reviewerFailures += 1;
    return;
  }

  const written = await applyReviewToHusk(boxRoot, {
    relPath: session.huskPath,
    output,
    spanId,
    snippetTitle: session.snippetTitle,
    storedOwner: previous.titleOwner,
    storedHash: previous.titleHash,
    ownerEmail: options.ownerEmail,
  });
  for (const field of written.rejected) summary.rejected.push(`${session.sessionId}:${field}`);

  // A span whose account was rejected was NOT folded in, so it must stay
  // unclaimed and be retried — but count the attempt, or a model that keeps
  // producing leaky output would be retried every night forever.
  const applied = written.spanApplied
    ? appliedSpanFor({
        sessionId: session.sessionId,
        entries,
        endIndex: span.endIndex,
        now: options.now,
      })
    : null;
  state.sessions[session.sessionId] = {
    ...previous,
    ...(applied !== null ? { applied: { ...previous.applied, [METADATA_CONSUMER]: applied } } : {}),
    titleOwner: written.titleOwner,
    titleHash: written.titleHash,
    attempts: written.spanApplied ? 0 : previous.attempts + 1,
    ...(written.spanApplied ? {} : { failedSpanId: spanId }),
  };
  if (written.spanApplied) summary.reviewed += 1;
}

/**
 * Run the pass. Throws {@link LockHeldError} when another run holds the lock —
 * the caller reports the holder rather than proceeding, since two concurrent
 * runs would each pay for the same model calls and the loser's writes would be
 * thrown away.
 */
export async function runChatReview(boxRoot: string, options: RunOptions): Promise<RunSummary> {
  return withChatReviewLock(boxRoot, {
    holder: "chat-review",
    fn: async () => {
      const state = await loadReviewState(boxRoot);
      const discovery = await discoverSessions(boxRoot, {
        now: options.now,
        quiescenceMs: QUIESCENCE_MS,
        state,
      });
      const planned = discovery.qualified.slice(0, options.maxSessions);
      const summary = emptySummary();
      summary.overflow = discovery.qualified.length - planned.length;
      // Seeded before the loop, not assigned after it: reviewOne can add to
      // missingTranscripts when a transcript disappears between the two reads.
      summary.missingTranscripts = discovery.missingTranscripts;
      summary.deferredActive = discovery.deferredActive.length;
      summary.belowThreshold = discovery.belowThreshold;
      // Seeded like missingTranscripts: reviewOne can add to it when a transcript
      // crosses the read cap between discovery's read and the reviewer's.
      summary.boundaryBeyondWindow = discovery.boundaryBeyondWindow;

      // One unreadable transcript or unwritable husk must not cost the night's
      // other sessions, nor the journal advances already earned.
      for (const session of planned) {
        try {
          await reviewOne(session, { boxRoot, options, state, summary });
        } catch (e) {
          console.error(`chat-review: session ${session.sessionId} failed:`, e);
          recordFailure(state, { sessionId: session.sessionId, spanId: "" });
          summary.sessionErrors += 1;
        }
      }

      state.lastRunAt = options.now.toISOString();
      await saveReviewState(boxRoot, state);
      return summary;
    },
  });
}

export { LockHeldError };
