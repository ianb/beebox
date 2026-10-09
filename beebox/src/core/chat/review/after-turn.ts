/**
 * Title a chat in session, right after a turn completes, instead of waiting
 * for the nightly chat-review run.
 *
 * Only the title pass runs here (`run/title.ts`), against the same title
 * journal and under the same lock as the nightly run, so the two never title
 * one span twice: once this path has written a title the session has a title
 * journal entry, every later turn skips here, and the nightly run refreshes the
 * title from its own gates as before. A `manual` title is never touched.
 *
 * The gate ({@link afterTurnTitleGate}) has no span-size check: the second
 * user turn always qualifies, and the first does when the person's
 * first message alone says enough to name the chat.
 */

import { findChatHuskEntry } from "../husk-read.js";
import { qualifySessionForTitle } from "./discovery.js";
import { titleOneSession } from "./run/core.js";
import { LockHeldError, withChatReviewLock } from "./lock.js";
import {
  loadReviewState,
  MAX_REVIEW_ATTEMPTS,
  saveReviewState,
  sessionState,
  TITLE_CONSUMER,
} from "./state.js";
import type { ChatReviewer } from "./reviewer.js";

/**
 * Characters of the first user message (whitespace collapsed, wrappers
 * stripped) that let one exchange qualify. About one sentence that names a
 * subject ("Help me plan a birthday dinner for Saturday"); a greeting or "can
 * you help me?" stays below it and waits for the second turn.
 */
export const FIRST_TURN_TITLE_CHARS = 40;

/**
 * Whether a session gets its title now: two user turns, or one whose first
 * message is at least {@link FIRST_TURN_TITLE_CHARS} long. `firstMessage` is
 * the 80-char snippet discovery derives, so the comparison is exact below 80.
 */
export function afterTurnTitleGate(args: { userTurns: number; firstMessage: string | null }): boolean {
  if (args.userTurns >= 2) return true;
  return args.userTurns === 1 && (args.firstMessage?.length ?? 0) >= FIRST_TURN_TITLE_CHARS;
}

type AfterTurnOutcome =
  | { kind: "titled"; title: string }
  | {
    kind: "skipped";
    reason: "has-title-journal" | "manual" | "gave-up" | "no-husk" | "not-qualified" | "below-gate" | "busy" | "not-titled";
  };

/** Title one session now if it qualifies. Throws only on unexpected failures. */
export async function titleChatAfterTurn(
  boxRoot: string,
  args: { sessionId: string; reviewer: ChatReviewer; now: Date; ownerEmail: string | null },
): Promise<AfterTurnOutcome> {
  try {
    return await withChatReviewLock(boxRoot, {
      holder: "chat-title-after-turn",
      fn: () => titleUnderLock(boxRoot, args),
    });
  } catch (e) {
    // The nightly run (or this path for another turn) holds the journal; the
    // next turn or the nightly run titles the chat instead.
    if (e instanceof LockHeldError) return { kind: "skipped", reason: "busy" };
    throw e;
  }
}

async function titleUnderLock(
  boxRoot: string,
  args: { sessionId: string; reviewer: ChatReviewer; now: Date; ownerEmail: string | null },
): Promise<AfterTurnOutcome> {
  const state = await loadReviewState(boxRoot);
  const previous = sessionState(state, args.sessionId);
  if (previous.applied[TITLE_CONSUMER] !== undefined) return { kind: "skipped", reason: "has-title-journal" };
  if (previous.titleOwner === "manual") return { kind: "skipped", reason: "manual" };
  // Bounded: after MAX_REVIEW_ATTEMPTS failures the nightly run owns retries.
  if ((previous.titleAttempts ?? 0) >= MAX_REVIEW_ATTEMPTS) return { kind: "skipped", reason: "gave-up" };

  const husk = await findChatHuskEntry(boxRoot, args.sessionId);
  if (husk === null) return { kind: "skipped", reason: "no-husk" };
  const { qualified } = await qualifySessionForTitle(boxRoot, { husk, now: args.now, state });
  if (qualified === null) return { kind: "skipped", reason: "not-qualified" };
  if (!afterTurnTitleGate({ userTurns: qualified.userTurns, firstMessage: qualified.snippetTitle })) {
    return { kind: "skipped", reason: "below-gate" };
  }

  const title = await titleOneSession(qualified, {
    boxRoot, reviewer: args.reviewer, now: args.now, state, ownerEmail: args.ownerEmail,
  });
  await saveReviewState(boxRoot, state);
  return title === null ? { kind: "skipped", reason: "not-titled" } : { kind: "titled", title };
}

/** The part of a root chat session this wiring needs. */
interface TurnSource {
  on(event: "done", listener: (msg: { is_error?: boolean }) => void): unknown;
  getSessionId(): string | null;
}

/**
 * Title a root chat after each completed turn, fire-and-forget: the turn is
 * already delivered, so a failure is logged and the chat stays untitled until
 * a later turn or the nightly run. One attempt per turn, no retry loop.
 */
export function wireAfterTurnTitling(
  session: TurnSource,
  deps: {
    boxRoot: string;
    reviewer: ChatReviewer;
    now: () => Date;
    ownerEmail: () => string | null;
    onTitled: (event: { sessionId: string; title: string }) => void;
  },
): void {
  session.on("done", (msg) => {
    const sessionId = session.getSessionId();
    if (sessionId === null || msg.is_error === true) return;
    titleChatAfterTurn(deps.boxRoot, {
      sessionId, reviewer: deps.reviewer, now: deps.now(), ownerEmail: deps.ownerEmail(),
    }).then((outcome) => {
      if (outcome.kind === "titled") deps.onTitled({ sessionId, title: outcome.title });
    }).catch((e: unknown) => {
      console.error(`chat-review: after-turn title for session ${sessionId} failed:`, e);
    });
  });
}
