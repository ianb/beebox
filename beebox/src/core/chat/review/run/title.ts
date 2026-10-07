/**
 * The title pass — the cheap gate's half of a chat-review run
 * (`docs/implemented-plans/chat-titles.md` § Track A).
 *
 * Reads only the title journal's window, asks the reviewer for a title (after
 * the freshness check, once wired), and advances the title journal alone. A
 * metadata pass subsumes it — that pass refreshes the title against its own
 * span and advances both journals — so this path runs only on sessions whose
 * growth clears {@link TITLE_CHAR_THRESHOLD} but not the summary gate.
 *
 * No husk span marker here, deliberately: a title write *replaces* rather than
 * extends, so the double-apply hazard that makes `review-span` necessary for
 * accounts cannot occur. What a crash between the husk write and the state
 * save CAN lose is the title's provenance: with no stored hash, the replay
 * reads our own title as a hand edit and leaves it alone for good. The run
 * saves state after every session (`run/core.ts`) so that window is one
 * atomic write wide; the residual is accepted rather than adding a durable
 * provenance marker to the card.
 */

import { elideMiddle, MAX_RENDERED_CHARS, renderEntries } from "../../transcript-render.js";
import { FRESHNESS_RECENT_CHARS, type TitleFreshnessChecker } from "../freshness.js";
import { readSessionWindow, type QualifiedSession } from "../discovery.js";
import { appliedSpanFor, computeSpanId, type ResolvedSpan } from "../span.js";
import { applyTitleToHusk, readHuskFields, resolveTitleOwner } from "./husk-write.js";
import type { ChatReviewer } from "../reviewer.js";
import {
  MAX_REVIEW_ATTEMPTS,
  sessionState,
  TITLE_CONSUMER,
  type ReviewState,
  type ReviewSessionState,
  type TitleOwner,
} from "../state.js";

/** Everything the title pass mutates apart from the card it writes. */
export interface TitleRunContext {
  boxRoot: string;
  reviewer: ChatReviewer;
  now: Date;
  state: ReviewState;
  summary: {
    titled: number;
    titlesKept: number;
    reviewerFailures: number;
    exhausted: number;
    missingTranscripts: number;
    rejected: string[];
  };
  ownerEmail: string | null;
  /**
   * The cheap gate in front of the reviewer. Absent when Jev is
   * unconfigured — the reviewer runs instead, which costs more and stays
   * correct.
   */
  freshness?: TitleFreshnessChecker;
}

/** The title pass's counterpart of the metadata run's failure recorder — separate counters, same give-up rule. */
function recordTitleFailure(state: ReviewState, args: { sessionId: string; spanId: string }): void {
  const previous = sessionState(state, args.sessionId);
  state.sessions[args.sessionId] = {
    ...previous,
    titleAttempts: (previous.titleAttempts ?? 0) + 1,
    titleFailedSpanId: args.spanId,
  };
}

/** Record the title journal's advance (and the pass's title provenance when given). */
function advanceTitleJournal(
  state: ReviewState,
  args: {
    session: QualifiedSession;
    span: ResolvedSpan;
    now: Date;
    previous: ReviewSessionState;
    titleOwner?: TitleOwner;
    titleHash?: string | null;
  },
): void {
  const applied = appliedSpanFor({ sessionId: args.session.sessionId, span: args.span, now: args.now });
  if (applied === null) return;
  state.sessions[args.session.sessionId] = {
    ...args.previous,
    applied: { ...args.previous.applied, [TITLE_CONSUMER]: applied },
    ...(args.titleOwner !== undefined ? { titleOwner: args.titleOwner } : {}),
    ...(args.titleHash !== undefined ? { titleHash: args.titleHash } : {}),
    titleAttempts: 0,
  };
}

/** The title pass over one qualified session. */
export async function reviewTitleSpan(
  session: QualifiedSession,
  ctx: TitleRunContext,
): Promise<void> {
  const { boxRoot, reviewer, now, state, summary } = ctx;

  const span = await readSessionWindow({
    sessionId: session.sessionId,
    logPath: session.logPath,
    state,
    consumer: TITLE_CONSUMER,
    ...(session.engine === "codex" ? { boxRoot } : {}),
  });
  if (span === null) {
    summary.missingTranscripts += 1;
    return;
  }

  if (span.bootstrap !== null && span.bootstrap !== "no-journal") {
    // Only the rewrite cases warn: a no-journal title bootstrap is the normal
    // first pass on a never-titled chat, not a surprise.
    console.warn(`chat-review: transcript for ${session.sessionId} was rewritten (${span.bootstrap}); re-reading the title span from the top`);
  }

  const endEntry = span.entries.at(-1);
  if (endEntry === undefined || span.endPrefixHash === null) return; // nothing new
  const spanId = computeSpanId({
    sessionId: session.sessionId,
    endUuid: endEntry.uuid,
    prefixHash: span.endPrefixHash,
  });

  const husk = await readHuskFields(boxRoot, session.huskPath);
  const previous = sessionState(state, session.sessionId);

  if ((previous.titleAttempts ?? 0) >= MAX_REVIEW_ATTEMPTS && previous.titleFailedSpanId === spanId) {
    summary.exhausted += 1;
    return;
  }

  // Ownership is resolved from the live card, not trusted from state: a
  // hand-edited title on a never-reviewed chat has state `unmanaged` — only
  // the card's value (not the snippet, not our hash) says a person wrote it.
  const owner = resolveTitleOwner({
    currentTitle: husk.title,
    snippetTitle: session.snippetTitle,
    storedOwner: previous.titleOwner,
    storedHash: previous.titleHash,
  });

  // A hand-owned title is permanent hands-off: no calls, journal advances. The
  // hand that owns the title owns its freshness.
  if (owner === "manual") {
    advanceTitleJournal(state, { session, span, now, previous, titleOwner: "manual", titleHash: null });
    return;
  }

  // The freshness check: one cheap Jev noul before any reviewer call. A
  // confident "still fits" keeps the title and advances the journal for
  // free; a failure or an unconfigured Jev falls through to the reviewer —
  // the costlier path is the correct fallback, and the warning keeps the
  // degradation visible.
  if (husk.title !== null && ctx.freshness !== undefined) {
    const rendered = renderEntries(span.entries);
    try {
      const { keeps } = await ctx.freshness.check({
        title: husk.title,
        recent: rendered.slice(Math.max(0, rendered.length - FRESHNESS_RECENT_CHARS)),
        sessionId: session.sessionId,
      });
      if (keeps) {
        advanceTitleJournal(state, { session, span, now, previous });
        summary.titlesKept += 1;
        return;
      }
    } catch (e) {
      console.warn(`chat-review: freshness check failed for ${session.sessionId}, running the title reviewer instead:`, e);
    }
  }

  let output;
  try {
    output = await reviewer.title({
      sessionId: session.sessionId,
      currentTitle: husk.title,
      span: elideMiddle(renderEntries(span.entries), MAX_RENDERED_CHARS),
    });
  } catch (e) {
    console.warn(`chat-review: title pass failed for ${session.sessionId}:`, e);
    recordTitleFailure(state, { sessionId: session.sessionId, spanId });
    summary.reviewerFailures += 1;
    return;
  }

  // "Keep" with nothing to keep is a failure, not a no-op — otherwise an
  // untitled chat would be marked title-seen by a model that answered
  // nothing (found in cross-model review of the plan).
  if (output.title === "" && husk.title === null) {
    recordTitleFailure(state, { sessionId: session.sessionId, spanId });
    summary.reviewerFailures += 1;
    return;
  }

  const written = await applyTitleToHusk(boxRoot, {
    relPath: session.huskPath,
    output,
    snippetTitle: session.snippetTitle,
    storedOwner: previous.titleOwner,
    storedHash: previous.titleHash,
    ownerEmail: ctx.ownerEmail,
  });
  for (const field of written.rejected) summary.rejected.push(`${session.sessionId}:${field}`);
  if (written.rejected.length > 0) {
    // The title was not folded in — retry the span next night, counted.
    recordTitleFailure(state, { sessionId: session.sessionId, spanId });
    return;
  }

  advanceTitleJournal(state, {
    session, span, now, previous,
    titleOwner: written.titleOwner,
    titleHash: written.titleHash,
  });
  summary.titled += 1;
}
