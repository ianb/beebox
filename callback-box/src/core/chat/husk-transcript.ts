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

import * as path from "node:path";
import { getSessionLogPath } from "./session/transcript-paths.js";
import type { ChatHuskEntry } from "./husk.js";

/** Absolute path to the transcript a husk points at. */
export function huskTranscriptPath(boxRoot: string, husk: ChatHuskEntry): string {
  const cwd =
    husk.contextDir !== undefined && husk.contextDir !== ""
      ? path.join(boxRoot, husk.contextDir)
      : boxRoot;
  return getSessionLogPath(cwd, husk.session);
}
