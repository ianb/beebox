/**
 * The metadata pass — the original whole review: title, `contains`, and the
 * running account for one session's unread summary-journal span
 * (`docs/implemented-plans/chat-review.md` § Track C).
 *
 * Also advances the **title** journal: the pass refreshed the title against
 * this span, so the cheap gate should not re-ask about the same material —
 * except when it offered no title for a chat that had none, which reconciled
 * nothing and retries on the title pass
 * (`docs/implemented-plans/chat-titles.md` § Track A).
 */

import { elideMiddle, MAX_RENDERED_CHARS, renderEntries } from "../../transcript-render.js";
import { readSessionWindow, type QualifiedSession } from "../discovery.js";
import { appliedSpanFor, computeSpanId, type ResolvedSpan } from "../span.js";
import { applyReviewToHusk, readHuskFields, resolveTitleOwner } from "./husk-write.js";
import type { ChatReviewer, ReviewOutput } from "../reviewer.js";
import { contentHash } from "../../../../lib/content-hash.js";
import {
  MAX_REVIEW_ATTEMPTS,
  METADATA_CONSUMER,
  sessionState,
  TITLE_CONSUMER,
  type ReviewState,
} from "../state.js";

/** What the metadata pass mutates apart from the card it writes. */
export interface MetadataRunContext {
  boxRoot: string;
  options: {
    reviewer: ChatReviewer;
    now: Date;
    ownerEmail: string | null;
  };
  state: ReviewState;
  summary: {
    reviewed: number;
    alreadyApplied: number;
    bootstrapped: number;
    rewritten: number;
    reviewerFailures: number;
    exhausted: number;
    missingTranscripts: number;
    rejected: string[];
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

/** The metadata pass over one qualified session. */
export async function reviewMetadataSpan(
  session: QualifiedSession,
  ctx: MetadataRunContext,
): Promise<void> {
  const { boxRoot, options, state, summary } = ctx;

  // Re-read the transcript here rather than carrying discovery's array on the
  // QualifiedSession: this is the only point where a window has to be resident,
  // and it is one session's worth (see discovery.ts). The span is recomputed
  // from the same journal, so it matches what discovery measured unless the
  // transcript changed underneath — in which case the fresh read is the right
  // one anyway.
  const span = await readSessionWindow({
    sessionId: session.sessionId,
    logPath: session.logPath,
    state,
    consumer: METADATA_CONSUMER,
    ...(session.engine === "codex" ? { boxRoot } : {}),
  });
  if (span === null) {
    // Vanished between discovery and now. Nothing to fold in; the husk stands.
    summary.missingTranscripts += 1;
    return;
  }

  if (span.bootstrap !== null) {
    summary.bootstrapped += 1;
    if (span.bootstrap !== "no-journal") {
      summary.rewritten += 1;
      console.warn(`chat-review: transcript for ${session.sessionId} was rewritten (${span.bootstrap}); ` + "re-reading from the top and keeping the existing account");
    }
  }

  const endEntry = span.entries.at(-1);
  if (endEntry === undefined || span.endPrefixHash === null) return; // nothing new — nothing to fold in
  const spanId = computeSpanId({
    sessionId: session.sessionId,
    endUuid: endEntry.uuid,
    prefixHash: span.endPrefixHash,
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
    repairJournalAfterCrash(state, { session, span, now: options.now, husk, previous });
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

  applyMetadataResult(state, {
    session,
    span,
    spanId,
    now: options.now,
    previous,
    output,
    huskTitle: husk.title,
    titleWritten: written.titleWritten,
    titleOwner: written.titleOwner,
    titleHash: written.titleHash,
    spanApplied: written.spanApplied,
  });
  if (written.spanApplied) summary.reviewed += 1;
}

/**
 * The crash-repair path: the husk already carries this span (its `review-span`
 * marker says so), so nothing is re-applied and both journals just catch up.
 */
function repairJournalAfterCrash(
  state: ReviewState,
  args: {
    session: QualifiedSession;
    span: ResolvedSpan;
    now: Date;
    husk: { title: string | null };
    previous: ReturnType<typeof sessionState>;
  },
): void {
  const applied = appliedSpanFor({ sessionId: args.session.sessionId, span: args.span, now: args.now });
  if (applied === null) return;
  // Re-derive title provenance as well. Losing the journal must not lose
  // the fact that we wrote the title we are looking at — otherwise the
  // field reverts to "unmanaged" and a later hand edit could be clobbered.
  const owner = resolveTitleOwner({
    currentTitle: args.husk.title,
    snippetTitle: args.session.snippetTitle,
    storedOwner: args.previous.titleOwner,
    storedHash: args.previous.titleHash,
  });
  state.sessions[args.session.sessionId] = {
    ...args.previous,
    // Both journals: the span's account AND its title are on the card.
    applied: { ...args.previous.applied, [METADATA_CONSUMER]: applied, [TITLE_CONSUMER]: applied },
    titleOwner: owner,
    titleHash: owner === "generated" && args.husk.title !== null ? contentHash(args.husk.title) : args.previous.titleHash,
    attempts: 0,
  };
}

/** Fold the pass's result into the journal: metadata when the account landed, title when the title reconciled. */
function applyMetadataResult(
  state: ReviewState,
  args: {
    session: QualifiedSession;
    span: ResolvedSpan;
    spanId: string;
    now: Date;
    previous: ReturnType<typeof sessionState>;
    output: ReviewOutput;
    /** The title the husk carried before this pass (for the keep-rule below). */
    huskTitle: string | null;
    titleWritten: boolean;
    titleOwner: ReturnType<typeof resolveTitleOwner>;
    titleHash: string | null;
    spanApplied: boolean;
  },
): void {
  const { session, previous, output } = args;
  // The span entry exists independently of whether the account survived the
  // leak scan — the title may have reconciled against this span even then.
  const spanEntry = appliedSpanFor({ sessionId: session.sessionId, span: args.span, now: args.now });
  // The title journal advances when this pass reconciled the title with the
  // span: it wrote one, or it deliberately kept the one already there. An
  // empty offer against a chat with NO title reconciled nothing — that is the
  // no-empty-title-without-title rule, and it retries on the title pass. A
  // hand-owned title is reconciled by definition: the pass may not touch it,
  // so leaving the title journal behind would only spend a later title-pass
  // slot rediscovering that.
  const titleReconciled = args.titleWritten
    || args.titleOwner === "manual"
    || (output.title === "" && args.huskTitle !== null);
  const metadataApplied = args.spanApplied ? spanEntry : null;
  const titleApplied = titleReconciled ? spanEntry : null;
  state.sessions[session.sessionId] = {
    ...previous,
    ...(metadataApplied !== null || titleApplied !== null
      ? {
        applied: {
          ...previous.applied,
          ...(metadataApplied !== null ? { [METADATA_CONSUMER]: metadataApplied } : {}),
          ...(titleApplied !== null ? { [TITLE_CONSUMER]: titleApplied } : {}),
        },
      }
      : {}),
    titleOwner: args.titleOwner,
    titleHash: args.titleHash,
    attempts: args.spanApplied ? 0 : previous.attempts + 1,
    ...(args.spanApplied ? {} : { failedSpanId: args.spanId }),
    titleAttempts: titleApplied !== null ? 0 : (previous.titleAttempts ?? 0) + 1,
    ...(titleApplied !== null ? {} : { titleFailedSpanId: args.spanId }),
  };
}
