/**
 * Chat-review journal state — which transcript spans have been folded into
 * each session's account, and who owns each husk's title.
 *
 * Persisted at `.beebox/chat-review/state.json` (box-local machine
 * state, like the retro walker's). Unlike retro's state
 * (`core/retro/state.ts`), which is a terminal "done, never look again"
 * predicate, this is a *journal*: a session is re-read every time it grows
 * past the threshold, so what's recorded is the boundary of what has already
 * been read, not a finished flag.
 *
 * See docs/implemented-plans/chat-review.md § Track A.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { errnoCode } from "../../../lib/error-guards.js";
import { writeFileAtomic } from "../../../lib/atomic-write.js";

const STATE_FILE = ".beebox/chat-review/state.json";

/** Reviewer attempts per session before it is skipped permanently. */
export const MAX_REVIEW_ATTEMPTS = 2;

/** The journal consumer this plan ships. Others (fan-out sinks) would key alongside. */
export const METADATA_CONSUMER = "metadata";

const AppliedSpanSchema = z.object({
  /** sha256(sessionId + endUuid + prefixHash) — the idempotency key. */
  spanId: z.string(),
  /** uuid of the last entry folded into the account. Authoritative. */
  endUuid: z.string(),
  /** Index of that entry when written. Advisory only — a rewrite moves it. */
  endIndex: z.number().int(),
  /** sha256 over every entry uuid up to and including endUuid. Detects rewrites. */
  prefixHash: z.string(),
  at: z.string(),
});

/**
 * Who last wrote a husk's title.
 *
 * - `unmanaged` — we have never written one (includes the first-message
 *   snippet `ensureChatHusk` may have set). Ours to replace.
 * - `generated` — we wrote the current title. Ours to replace when stale.
 * - `manual` — a human or another agent changed it. Never written again.
 *
 * The transition to `manual` is one-way and re-checked every pass, so an edit
 * made before the session was ever reviewed is still honoured.
 */
const TitleOwnerSchema = z.enum(["unmanaged", "generated", "manual"]);

const ReviewSessionStateSchema = z.object({
  /** Applied spans keyed by consumer; see METADATA_CONSUMER. */
  applied: z.record(z.string(), AppliedSpanSchema),
  titleOwner: TitleOwnerSchema,
  /** sha256 of the title we last wrote; null when we never have. */
  titleHash: z.string().nullable(),
  /** Consecutive failures on `failedSpanId`. At MAX_REVIEW_ATTEMPTS that span is given up on. */
  attempts: z.number().int(),
  /**
   * The span those attempts failed on. Scoping the give-up to one span means
   * new conversation is always tried afresh — a provider outage can't retire a
   * session permanently.
   */
  failedSpanId: z.string().optional(),
});

const ReviewStateSchema = z.object({
  lastRunAt: z.string().nullable(),
  sessions: z.record(z.string(), ReviewSessionStateSchema),
});

export type AppliedSpan = z.infer<typeof AppliedSpanSchema>;
export type TitleOwner = z.infer<typeof TitleOwnerSchema>;
export type ReviewSessionState = z.infer<typeof ReviewSessionStateSchema>;
export type ReviewState = z.infer<typeof ReviewStateSchema>;

export function emptyReviewState(): ReviewState {
  return { lastRunAt: null, sessions: {} };
}

/** A session with no journal entry yet — the bootstrap shape. */
export function emptySessionState(): ReviewSessionState {
  return { applied: {}, titleOwner: "unmanaged", titleHash: null, attempts: 0 };
}

/** This session's state, or the bootstrap shape when it has none. */
export function sessionState(state: ReviewState, sessionId: string): ReviewSessionState {
  return state.sessions[sessionId] ?? emptySessionState();
}

/**
 * Load journal state, treating a missing file as a fresh start. A corrupt or
 * schema-mismatched file also starts fresh (with a warning).
 *
 * The cost of starting fresh is bounded but not zero: a session whose
 * transcript has not grown re-derives the same span id, matches the husk's
 * `review-span` marker, and costs nothing. One that HAS grown is re-read from
 * the top as a bootstrap, so material already in the account is summarized
 * again — the account absorbs it (the model is given the account and asked to
 * revise, not append), but it is a real model call, not a no-op.
 */
export async function loadReviewState(boxRoot: string): Promise<ReviewState> {
  const filePath = path.join(boxRoot, STATE_FILE);
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf-8");
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`chat-review: could not read ${STATE_FILE}, starting fresh:`, e);
    }
    return emptyReviewState();
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    console.warn(`chat-review: ${STATE_FILE} is not valid JSON, starting fresh:`, e);
    return emptyReviewState();
  }

  const parsed = ReviewStateSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(`chat-review: ${STATE_FILE} did not match the expected shape, starting fresh`);
    return emptyReviewState();
  }
  return parsed.data;
}

/** Strict mutation read: missing is empty, but unreadable or malformed aborts deletion. */
async function loadReviewStateForMutation(boxRoot: string): Promise<ReviewState> {
  const filePath = path.join(boxRoot, STATE_FILE);
  try {
    const text = await fs.readFile(filePath, "utf-8");
    return ReviewStateSchema.parse(JSON.parse(text));
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return emptyReviewState();
    throw error;
  }
}

/** Preflight destructive mutation without changing the journal. */
export async function assertReviewStateReadableForDeletion(boxRoot: string): Promise<void> {
  await loadReviewStateForMutation(boxRoot);
}

export async function saveReviewState(boxRoot: string, state: ReviewState): Promise<void> {
  const filePath = path.join(boxRoot, STATE_FILE);
  await writeFileAtomic(filePath, {
    content: JSON.stringify(state, null, 2) + "\n",
  });
}

/** Remove one session's review journal entry, preserving all other state. */
export async function removeSessionFromReview(boxRoot: string, sessionId: string): Promise<ReviewSessionState | null> {
  const state = await loadReviewStateForMutation(boxRoot);
  const previous = state.sessions[sessionId];
  if (previous === undefined) return null;
  delete state.sessions[sessionId];
  await saveReviewState(boxRoot, state);
  return previous;
}

/** Restore one removed journal entry after a compensated pre-storage failure. */
export async function restoreSessionToReview(boxRoot: string, options: { sessionId: string; previous: ReviewSessionState | null }): Promise<void> {
  const { sessionId, previous } = options;
  if (previous === null) return;
  const state = await loadReviewStateForMutation(boxRoot);
  if (state.sessions[sessionId] !== undefined) return;
  state.sessions[sessionId] = previous;
  await saveReviewState(boxRoot, state);
}
