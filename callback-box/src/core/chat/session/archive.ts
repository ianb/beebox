/**
 * Archiving a dead chat — filing away the card of a conversation that can no
 * longer be resumed (`docs/plans/chat-session-identity.md`, Track 3).
 *
 * Deliberately *not* delete's sibling in behaviour: nothing is removed, and
 * nothing about the chat's local state is touched, because there is no local
 * state left to touch. The card moves from `store/chat/web/` to
 * `store/chat/archive/`, and since `listChatHusks` reads `web/` only, that one
 * move takes it out of every chat list and out of the review corpus while
 * leaving it a searchable, git-tracked card.
 *
 * Offered only for a chat whose transcript is gone. Archiving a live chat
 * would hide a conversation the boxholder can still open — so a present
 * transcript is refused as a typed result rather than an exception: "this one
 * is still alive" is an answer the UI shows, not a failure.
 */

import * as path from "node:path";
import { executeMove } from "../../commands/move.js";
import { findChatHuskEntry, listChatHusksUnder } from "../husk-read.js";
import { acquireChatReviewLease } from "../review/lock.js";
import { loadDeadHusks } from "./list.js";
import { parseSdkSessionId } from "./session-id.js";
import { resolveSessionAvailability, type TranscriptState } from "./availability.js";
import type { ChatSessionRegistry } from "./registry.js";

/** Where archived husks live. Outside `store/chat/web/`, which is the point. */
const CHAT_ARCHIVE_DIR = "store/chat/archive";

class ChatArchiveMoveError extends Error {
  constructor(huskPath: string, detail: string | undefined) {
    super(`Could not move ${huskPath} to ${CHAT_ARCHIVE_DIR}/: ${detail ?? "unknown error"}`);
    this.name = "ChatArchiveMoveError";
  }
}

export type ArchiveChatResult =
  | { status: "archived"; sessionId: string; from: string; to: string; transcript: TranscriptState }
  /** Already filed away — archiving twice is the same as archiving once. */
  | { status: "already-archived"; sessionId: string; huskPath: string }
  /** The transcript is still here; the chat can be opened, so it is not filed away. */
  | { status: "refused"; sessionId: string; reason: "transcript-present"; huskPath: string }
  /**
   * The session is live in this server — assigned or reserved — even though no
   * transcript file has appeared yet. Filing it away would hide a conversation
   * the boxholder is in the middle of.
   */
  | { status: "refused"; sessionId: string; reason: "session-live"; huskPath: string | null }
  | { status: "not-found"; sessionId: string };

/** File a dead chat's card away under `store/chat/archive/`. */
export async function archiveChatSession(options: { boxRoot: string; sessionId: string; registry: ChatSessionRegistry }): Promise<ArchiveChatResult> {
  const sessionId = parseSdkSessionId(options.sessionId);
  // The same lease delete takes: archiving removes a session from the review
  // corpus, and a review pass mid-move would extend an account for a card that
  // is no longer where it looked.
  const releaseReview = await acquireChatReviewLease(options.boxRoot, "chat-archive");
  try {
    const archived = await listChatHusksUnder(options.boxRoot, CHAT_ARCHIVE_DIR);
    const already = archived.find((husk) => husk.session === sessionId);
    if (already !== undefined) return { status: "already-archived", sessionId, huskPath: already.path };

    // Membership in the dead list is the *disk* half of the eligibility test —
    // one definition of "there is nothing left to resume", shared with what the
    // lists display.
    const target = (await loadDeadHusks(options.boxRoot)).find((husk) => husk.sessionId === sessionId);
    // The server half. A chat is resumable from the moment its id is reserved
    // or assigned, which is before the engine has written a byte — so a chat
    // the boxholder is in the middle of sits in the dead list exactly like an
    // expired one, and archiving it would file away an open conversation.
    // `resolveSessionAvailability` is the one definition of "still open", the
    // same one the chat page gates its resume on.
    const availability = await resolveSessionAvailability({
      boxRoot: options.boxRoot,
      sessionId,
      registry: options.registry,
    });
    if (availability.kind === "resumable") {
      // Both refusals mean "still openable"; which one it is comes from the
      // dead list, since that is what says whether a transcript exists on disk.
      const huskPath = target?.huskPath ?? (await findChatHuskEntry(options.boxRoot, sessionId))?.path ?? null;
      if (target !== undefined) return { status: "refused", sessionId, reason: "session-live", huskPath };
      if (huskPath === null) return { status: "not-found", sessionId };
      return { status: "refused", sessionId, reason: "transcript-present", huskPath };
    }
    if (target === undefined) {
      const active = await findChatHuskEntry(options.boxRoot, sessionId);
      if (active === null) return { status: "not-found", sessionId };
      // Not resumable and no husk in the dead list: a chat mid-deletion, whose
      // card is on its way out. Reported as present rather than archived — the
      // deletion owns the card now.
      return { status: "refused", sessionId, reason: "transcript-present", huskPath: active.path };
    }

    // `executeMove` is the `cb mv` primitive: it carries the card's attachment
    // scope with it, rewrites refs to the card, and commits the whole move as
    // one change — the same reuse-a-box-command posture delete takes with
    // `trash`.
    const result = await executeMove(
      { boxRoot: options.boxRoot, write: () => {}, writeLine: () => {} },
      { from: target.huskPath, to: `${CHAT_ARCHIVE_DIR}/`, commit: true },
    );
    if (!result.success) throw new ChatArchiveMoveError(target.huskPath, result.error);
    return {
      status: "archived",
      sessionId,
      from: target.huskPath,
      to: path.posix.join(CHAT_ARCHIVE_DIR, path.posix.basename(target.huskPath)),
      transcript: target.transcript,
    };
  } finally {
    await releaseReview();
  }
}
