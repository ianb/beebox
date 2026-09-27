/**
 * The name of a file lock's guard directory.
 *
 * `file-lock.ts` takes a lock by `mkdir` of `<lockPath>.guard`, and the
 * directory exists for the whole life of the lock. The box-root vocabulary
 * admits the guard of every root-level lock by the same rule, so both import
 * it from here. No Node imports: the vocabulary module reaches the frontend.
 */

const LOCK_GUARD_SUFFIX = ".guard";

export function lockGuardPath(lockPath: string): string {
  return `${lockPath}${LOCK_GUARD_SUFFIX}`;
}
