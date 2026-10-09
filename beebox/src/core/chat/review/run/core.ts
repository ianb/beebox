/**
 * One chat-review run: discover qualifying sessions, review each unread span,
 * write the result to its husk, and advance the journal.
 *
 * Two passes share the run (`docs/implemented-plans/chat-titles.md`): the **metadata
 * pass** (title + `contains` + account, summary-gated, `run/metadata.ts`) and
 * the **title pass** (title alone, cheap-gated, `run/title.ts`). A session
 * that qualifies for the metadata pass runs only that — it refreshes the
 * title against its own span and advances both journals.
 *
 * Two things make a run safe to interrupt or repeat:
 *
 * - A **cross-process lock** around the whole run. `withCardLock` only
 *   coordinates within one Node process, so it cannot stop a manual
 *   `bbx chat review run` from racing the scheduled one — different PIDs. The
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
import { errnoCode } from "../../../../shared/error-guards.js";
import { discoverSessions, QUIESCENCE_MS, type QualifiedSession } from "../discovery.js";
import { reviewMetadataSpan } from "./metadata.js";
import { reviewTitleSpan, type TitleRunContext } from "./title.js";
import { readHuskFields } from "./husk-write.js";
import type { ChatReviewer } from "../reviewer.js";
import type { TitleFreshnessChecker } from "../freshness.js";
import { loadReviewState, saveReviewState, type ReviewState } from "../state.js";
import { LockHeldError, withChatReviewLock } from "../lock.js";
import { readCodexSessionUpdatedAt } from "../../session/codex-transcript/core.js";
import { commitSessionManifest } from "../../../agent/manifest.js";

export interface RunOptions {
  reviewer: ChatReviewer;
  maxSessions: number;
  now: Date;
  /** Box owner's email — never counted as a leak when it appears. */
  ownerEmail: string | null;
  /**
   * The Jev freshness check, when Jev is configured. Absent → the title
   * reviewer runs on every qualifying growth (correct, costlier).
   */
  freshness?: TitleFreshnessChecker;
}

export interface RunSummary {
  /** Sessions whose metadata pass completed and was written. */
  reviewed: number;
  /** Sessions titled by the title pass (the cheap gate), written or kept. */
  titled: number;
  /** Sessions whose titles the freshness check kept with zero model calls. */
  titlesKept: number;
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
  belowTitleThreshold: number;
  /** Sessions skipped for having too few real user turns. */
  tooFewTurns: number;
  /** Sessions this machine did not originate, so it does not review them. */
  foreignOrigin: number;
  /** Qualified sessions beyond --max-sessions; they wait for the next run. */
  overflow: number;
}

function emptySummary(): RunSummary {
  return {
    reviewed: 0,
    titled: 0,
    titlesKept: 0,
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
    belowTitleThreshold: 0,
    tooFewTurns: 0,
    foreignOrigin: 0,
    overflow: 0,
  };
}

/**
 * Review one session: re-check quiescence, then dispatch to the pass its
 * growth qualified it for.
 */
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
  // inside each pass — so re-check it against the file as it stands now, and
  // defer rather than summarize a conversation back in progress.
  let mtime: Date;
  try {
    mtime = session.engine === "codex"
      ? await readCodexSessionUpdatedAt(boxRoot, session.sessionId)
      : (await fs.stat(session.logPath)).mtime;
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") throw e;
    summary.missingTranscripts += 1;
    return;
  }
  if (options.now.getTime() - mtime.getTime() < QUIESCENCE_MS) {
    summary.deferredActive += 1;
    return;
  }

  if (session.needsMetadata) {
    await reviewMetadataSpan(session, { boxRoot, options, state, summary });
    return;
  }
  await reviewTitleSpan(session, {
    boxRoot,
    reviewer: options.reviewer,
    now: options.now,
    state,
    summary,
    ownerEmail: options.ownerEmail,
    ...(options.freshness === undefined ? {} : { freshness: options.freshness }),
  });
}

/**
 * The title pass alone over one session, for the after-turn path
 * (`../after-turn.ts`), which holds the lock and saves the state. Returns the
 * title the pass wrote, or null when it wrote none.
 */
export async function titleOneSession(
  session: QualifiedSession,
  ctx: Omit<TitleRunContext, "summary" | "freshness">,
): Promise<string | null> {
  const summary: TitleRunContext["summary"] = {
    titled: 0, titlesKept: 0, reviewerFailures: 0, exhausted: 0, missingTranscripts: 0, rejected: [],
  };
  await reviewTitleSpan(session, { ...ctx, summary });
  if (summary.titled === 0) return null;
  return (await readHuskFields(ctx.boxRoot, session.huskPath)).title;
}

/**
 * Run the pass. Throws {@link LockHeldError} when another run holds the lock —
 * the caller reports the holder rather than proceeding, since two concurrent
 * runs would each pay for the same model calls and the loser's writes would be
 * thrown away.
 */
export async function runChatReview(boxRoot: string, options: RunOptions): Promise<RunSummary> {
  const result = await withChatReviewLock(boxRoot, {
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
      // Seeded before the loop, not assigned after it: the per-session steps
      // can add to missingTranscripts when a transcript disappears between the
      // two reads.
      summary.missingTranscripts = discovery.missingTranscripts;
      summary.deferredActive = discovery.deferredActive.length;
      summary.belowThreshold = discovery.belowThreshold;
      summary.belowTitleThreshold = discovery.belowTitleThreshold;
      summary.tooFewTurns = discovery.tooFewTurns;
      summary.foreignOrigin = discovery.foreignOrigin;

      // One unreadable transcript or unwritable husk must not cost the night's
      // other sessions, nor the journal advances already earned.
      for (const session of planned) {
        try {
          await reviewOne(session, { boxRoot, options, state, summary });
        } catch (e) {
          console.error(`chat-review: session ${session.sessionId} failed:`, e);
          summary.sessionErrors += 1;
        }
        // Saved after every session, not once at the end. A run spans many
        // model calls, so a process killed mid-run (a deploy restart) used to
        // lose every journal advance AND every title-ownership record the run
        // had earned — and on the replay a title this pass wrote, with no
        // stored hash, classifies as a hand edit and is never retitled again.
        // Per-session saving shrinks that window to the gap between the husk
        // write and this one atomic write.
        await saveReviewState(boxRoot, state);
      }

      state.lastRunAt = options.now.toISOString();
      await saveReviewState(boxRoot, state);
      return summary;
    },
  });
  // Each model pass appended its session to the tracked usage manifest, and the
  // husk writes are not committed here, so the run commits that file itself —
  // after the review lock is released, since the commit takes the box git lock.
  try {
    await commitSessionManifest(boxRoot);
  } catch (e) {
    console.warn("chat-review: could not commit the usage manifest after the run:", e);
  }
  return result;
}

export { LockHeldError };
