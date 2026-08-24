/**
 * Shared internals for the git operation modules.
 *
 * Leaf module: holds the typed error classes, the index.lock detection +
 * retry primitive, and the custom log format used across git.ts and
 * git-log.ts. Nothing here imports back from those files, so there is no
 * value-import cycle.
 */

import { spawn } from "node:child_process";
import { simpleGit } from "simple-git";

/**
 * A git command failed with an error we don't specifically handle (i.e. not an
 * index.lock collision). Wraps the underlying cause so callers get a typed,
 * programmatically-distinguishable error while the original message is
 * preserved.
 */
export class GitCommandError extends Error {
  readonly cause: unknown;
  /** `message` overrides the cause's own wording — subclasses use it to say
   *  what KIND of failure this is while keeping the original text. */
  constructor(cause: unknown, message?: string) {
    super(message ?? causeMessage(cause));
    this.name = "GitCommandError";
    this.cause = cause;
  }
}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The marker every contended-git failure message carries.
 *
 * A scheduled task usually runs as a CHILD PROCESS, so a JS error subclass
 * never reaches the scheduler that records the failure — only the child's
 * captured output does. A stable token in the message is what survives that
 * boundary. Detecting a condition by message match is a deliberate choice
 * here, following `isIndexLockError` below, and cheaper than giving the whole
 * CLI an exit-code vocabulary for one diagnostic.
 */
export const GIT_CONTENDED_MARKER = "[git-contended]";

/**
 * The marker a failure carries when `.git/index.lock` looks ABANDONED rather
 * than contended — old, and either unheld or with no way to tell. Separate
 * from {@link GIT_CONTENDED_MARKER} because the two demand opposite responses:
 * contention resolves itself, an abandoned lock never does and needs the file
 * removed. Same message-token reasoning as the contended marker — a scheduled
 * task's failure crosses a process boundary as text.
 */
export const GIT_STALE_LOCK_MARKER = "[git-stale-lock]";

/**
 * A git index mutation failed on `.git/index.lock`.
 *
 * Two distinguishable conditions share one error class because git reports
 * them with one message:
 *
 * - **Contended** — another process holds the index right now. Distinct from a
 *   generic {@link GitCommandError} so a scheduled task that LOST A RACE stops
 *   reading like a scheduled task that is BROKEN. It clears on its own.
 * - **Stale** — a crashed or SIGKILLed git left the file behind and nothing
 *   holds it. It never clears on its own, so reporting it as contention is a
 *   false statement that invites waiting it out forever. `git-stale-lock.ts`
 *   removes such a lock when it can prove it is abandoned; this error is what
 *   is raised when it could not (the age gate not yet met, or no usable way to
 *   check for a holder), and it names the file so a human can act.
 */
export class GitIndexLockError extends GitCommandError {
  constructor(cause: unknown, staleLockPath?: string) {
    super(
      cause,
      staleLockPath === undefined
        ? `${GIT_CONTENDED_MARKER} another process holds the git index: ${causeMessage(cause)}`
        : `${GIT_STALE_LOCK_MARKER} ${staleLockPath} looks abandoned — no git process holds it, ` +
            `and it did not clear. If no git is running, delete it: ${causeMessage(cause)}`,
    );
    this.name = "GitIndexLockError";
  }
}

/**
 * Whether a recorded failure message describes git-index contention rather
 * than broken work. Matches our own marker AND git's raw `index.lock` wording,
 * so a box agent's own `git` failing inside a scheduled script is recognised
 * too — that writer never runs our code and cannot carry our marker.
 *
 * A stale-lock failure is NOT contention and is excluded: it is a defect that
 * needs attention, not a race that resolves itself.
 */
export function isContendedFailure(message: string): boolean {
  if (message.includes(GIT_STALE_LOCK_MARKER)) return false;
  return message.includes(GIT_CONTENDED_MARKER) || message.includes("index.lock");
}

/** Whether a recorded failure message describes an abandoned index lock. */
export function isStaleLockFailure(message: string): boolean {
  return message.includes(GIT_STALE_LOCK_MARKER);
}

/**
 * A git operation was called with no paths where at least one is required.
 */
export class NoPathsError extends Error {
  constructor() {
    super("commitPaths requires at least one path");
    this.name = "NoPathsError";
  }
}

/**
 * Check if a git error is an index.lock collision. These happen when LFS
 * post-commit hooks or filter-process operations overlap with the next
 * git command — common when boxes track large binary files via LFS.
 */
export function isIndexLockError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("index.lock");
}

/**
 * Check if a git commit failed only because nothing was staged. A box runs its
 * own auto-commit machinery (`git add -A` in wakeup/scheduler), so an explicit
 * write-then-commit can lose the race: the just-written files are already
 * committed by the time our `commit` runs, and git exits non-zero with
 * "nothing to commit". That outcome is benign — the content IS committed, just
 * not by us — so callers that only care about the content landing can treat it
 * as success rather than an error.
 */
export function isNothingToCommitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("nothing to commit");
}


/**
 * A housekeeping `git add -A` must never sweep a large blob into the box
 * repo. The limit is on the STAGED object size (git's actual cost), not
 * disk size — so git-lfs media (committed as ~130-byte pointers) always
 * passes regardless of how big the file is, while a big regular file is
 * caught. Files over the limit are left unstaged for a human/agent to
 * handle deliberately (LFS-track it, gitignore it, or remove it).
 */
const MAX_AUTO_STAGE_BYTES = 10 * 1024 * 1024;

/** `git cat-file --batch-check` answered something other than one line per input. */
export class GitBatchMismatchError extends Error {
  constructor(expected: number, received: number) {
    super(`git cat-file --batch-check returned ${received} lines for ${expected} paths`);
    this.name = "GitBatchMismatchError";
  }
}

/** A git process spawned for a batch query exited non-zero. */
export class GitBatchFailedError extends Error {
  constructor(failure: { args: string[]; code: number | null; stderr: string }) {
    const status = failure.code === null ? "on a signal" : String(failure.code);
    super(`git ${failure.args.join(" ")} exited ${status}: ${failure.stderr.trim()}`);
    this.name = "GitBatchFailedError";
  }
}

/** Run a git command that takes its work list on stdin, and collect stdout. */
function gitWithInput(options: { cwd: string; args: string[]; input: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", options.args, { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new GitBatchFailedError({ args: options.args, code, stderr }));
    });
    child.stdin.end(options.input);
  });
}

/**
 * Staged blob sizes for repo-root-relative paths, in ONE git process.
 *
 * `git cat-file -s :path` per file is the obvious spelling and costs a process
 * spawn each. That is not a micro-optimisation: a fresh `cb init` stages 126
 * files, and spawning `cat-file` 126 times accounted for roughly 4 of its 5.7
 * seconds — a cost every boxholder and every housekeeping commit pays, since
 * `stageAll` is on the wakeup path.
 *
 * `--batch-check` takes every spec on stdin and answers them in order, one
 * process total. `-z` makes the INPUT NUL-delimited, so a path containing a
 * newline cannot shift the correlation; output stays line-delimited, exactly
 * one line per input, which is what lets results be matched back by position.
 *
 * A path with no staged blob — a staged deletion — answers `<spec> missing`
 * and is simply absent from the result, matching the per-file version's
 * behaviour of catching that error and skipping (a deletion is not "adding a
 * big file").
 */
async function stagedBlobSizes(boxRoot: string, paths: string[]): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  if (paths.length === 0) return sizes;

  const stdout = await gitWithInput({
    cwd: boxRoot,
    args: ["cat-file", "--batch-check", "-z"],
    input: paths.map((path) => `:${path}\u0000`).join(""),
  });
  const lines = stdout.split("\n").filter((line) => line !== "");
  // Results are correlated by position, so a length mismatch means the
  // correlation is unsound — report rather than silently attribute one file's
  // size to another and unstage the wrong thing.
  if (lines.length !== paths.length) {
    throw new GitBatchMismatchError(paths.length, lines.length);
  }

  for (const [index, path] of paths.entries()) {
    const line = lines[index];
    if (line === undefined || line.endsWith(" missing")) continue;
    // `<sha> <type> <size>`
    const bytes = Number.parseInt(line.split(" ")[2] ?? "", 10);
    if (Number.isFinite(bytes)) sizes.set(path, bytes);
  }
  return sizes;
}

/**
 * After a blind `add -A`, unstage any staged file whose object exceeds
 * MAX_AUTO_STAGE_BYTES. Best-effort: a failure in the size check must never
 * break the commit, so it logs and proceeds with whatever is staged.
 */
export async function unstageOversizedBlobs(boxRoot: string): Promise<void> {
  try {
    const git = simpleGit(boxRoot);
    const out = await git.raw(["diff", "--cached", "--name-only", "-z"]);
    const paths = out.split("\0").filter((p) => p.length > 0);
    const oversized: Array<{ path: string; bytes: number }> = [];
    for (const [path, bytes] of await stagedBlobSizes(boxRoot, paths)) {
      if (bytes > MAX_AUTO_STAGE_BYTES) oversized.push({ path, bytes });
    }
    if (oversized.length > 0) {
      // `diff --cached` / `cat-file :path` paths are repo-root-relative, but a
      // `restore --staged -- <path>` pathspec is interpreted relative to CWD
      // (`boxRoot`) — on a v2 box that's `content/`, so a bare repo-relative
      // path would resolve to `content/content/...` and match nothing, letting
      // the oversized blob commit through. The `:/` magic prefix pins each
      // pathspec to the repo root, matching the diff's frame in both layouts.
      await git.raw(["restore", "--staged", "--", ...oversized.map((o) => `:/${o.path}`)]);
      const mb = (MAX_AUTO_STAGE_BYTES / (1024 * 1024)).toFixed(0);
      const list = oversized
        .map((o) => `${o.path} (${(o.bytes / (1024 * 1024)).toFixed(1)}MB)`)
        .join(", ");
      console.warn(
        `[git] Housekeeping skipped staging ${oversized.length} file(s) over ${mb}MB (left uncommitted — LFS-track, gitignore, or remove): ${list}`,
      );
    }
  } catch (err) {
    console.warn(`[git] Oversized-blob guard failed (proceeding): ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * A commit operation reported success but HEAD did not move.
 *
 * Almost always a hook: `git commit` exits non-zero when `pre-commit` or
 * `commit-msg` rejects, and boxes install both (`cb validate --staged`,
 * `git annex pre-commit`).
 */
export class CommitDidNotLandError extends Error {
  constructor(boxRoot: string) {
    super(
      `commit reported success but HEAD did not move in ${boxRoot} — a pre-commit or commit-msg hook most likely rejected it. Run \`git commit\` by hand to see the hook's output.`,
    );
    this.name = "CommitDidNotLandError";
  }
}

/** Shape of our custom git log format. */
export interface GitLogFormat {
  hash: string;
  date: string;
  subject: string;
  body: string;
}

export const LOG_FORMAT: GitLogFormat = {
  hash: "%H",
  date: "%aI",
  subject: "%s",
  body: "%b",
};
