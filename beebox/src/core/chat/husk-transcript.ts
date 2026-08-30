/**
 * Locate a husk's transcript.
 *
 * The husk's own `context-dir` binding is what resolves it — that directory
 * was the SDK's cwd when the session was created, and the SDK derives its log
 * path from cwd. No history-file lookup is involved.
 *
 * Extracted from `webapp/trpc/routers/chat.ts` when chat review became a
 * second caller (docs/implemented-plans/chat-review.md § Track A).
 */

import { containedSessionCwd, getSessionLogPath } from "./session/transcript-paths.js";
import type { ChatHuskEntry } from "./husk-read.js";

/**
 * Absolute path to the transcript a husk points at.
 *
 * `context-dir` is a card field — hand-editable, and carried in from whatever
 * checkout wrote the husk — so it goes through `containedSessionCwd` like every
 * other box-path resolution: a value naming `../../elsewhere` reads from the
 * box root (and warns) rather than pointing the encoder outside the box.
 */
export function huskTranscriptPath(boxRoot: string, husk: ChatHuskEntry): string {
  return getSessionLogPath(containedSessionCwd(boxRoot, husk.contextDir), husk.session);
}
