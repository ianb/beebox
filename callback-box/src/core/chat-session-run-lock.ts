/**
 * Run-lock helpers for ChatSession — acquire/release the chat-active lock
 * held for the duration of an SDK run.
 *
 * Extracted from the class so the body stays under the line limit. These are
 * thin idempotent wrappers over `acquireRunLock`/`releaseRunLock` in
 * `chat-session-state.ts`: they fold in the "already held / already released"
 * guards and return the new lock-path state, so the class just stores what
 * comes back. No reference to the ChatSession class itself.
 */

import {
  acquireRunLock as acquireChatRunLock,
  releaseRunLock as releaseChatRunLock,
} from "./chat-session-state.js";

/**
 * Acquire the chat-active lock unless one is already held. Returns the lock
 * path to store: the existing one when already held, the freshly acquired
 * path, or null if acquisition failed (logged non-fatally upstream).
 */
export async function acquireSessionRunLock(opts: {
  boxRoot: string;
  sessionId: string | null;
  currentLockPath: string | null;
}): Promise<string | null> {
  if (opts.currentLockPath !== null) return opts.currentLockPath;
  return acquireChatRunLock({ boxRoot: opts.boxRoot, sessionId: opts.sessionId });
}

/**
 * Release the held lock if any. Returns the new lock-path state (always null).
 */
export async function releaseSessionRunLock(currentLockPath: string | null): Promise<null> {
  if (currentLockPath === null) return null;
  await releaseChatRunLock(currentLockPath);
  return null;
}
