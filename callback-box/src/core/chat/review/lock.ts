import * as path from "node:path";
import { acquireLock, LockHeldError, releaseLock } from "../../../lib/file-lock.js";
import { withCardLock } from "../../../lib/card-lock.js";

const LOCK_FILE = ".callback-box/chat-review/run.lock";
const activeLocks = new Set<string>();

function localHolder(holder: string) {
  return {
    pid: process.pid,
    hostname: "this process",
    acquiredAt: new Date().toISOString(),
    metadata: { holder },
  };
}

/** Serialize review-journal consumers both within this process and across processes. */
export async function acquireChatReviewLease(boxRoot: string, holder: string): Promise<() => Promise<void>> {
  const lockPath = path.join(boxRoot, LOCK_FILE);
  const key = path.resolve(lockPath);
  if (activeLocks.has(key)) throw new LockHeldError(localHolder(holder));
  activeLocks.add(key);
  try {
    await withCardLock(lockPath, () => acquireLock(lockPath, { holder }));
  } catch (error) {
    activeLocks.delete(key);
    throw error;
  }
  return async () => {
    try {
      await releaseLock(lockPath);
    } finally {
      activeLocks.delete(key);
    }
  };
}

/** Fail fast when busy, then hold the review-journal lock for `fn`. */
export async function withChatReviewLock<T>(boxRoot: string, options: { holder: string; fn: () => Promise<T> }): Promise<T> {
  const release = await acquireChatReviewLease(boxRoot, options.holder);
  try {
    return await options.fn();
  } finally {
    await release();
  }
}

export { LockHeldError };
