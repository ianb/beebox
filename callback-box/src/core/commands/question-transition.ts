/**
 * Guarded status transitions for question cards.
 *
 * A question's status change (answer, dismiss, and later the aging sweep's
 * expiry) is a read-modify-write on the card that must be atomic across BOTH
 * separate processes and concurrent in-process tasks, and whose card + any
 * companion writes (the follow-up job) must land in a SINGLE commit — with
 * rollback if that commit fails, so a failed transition leaves the card exactly
 * as it was on disk and stays retryable (principle 4: resilient, never silent).
 *
 * Two locks compose here because they solve different problems (see
 * `lib/file-lock.ts` and `lib/card-lock.ts`):
 *   - the cross-process file lock serializes a web answer against a CLI answer
 *     or the aging sweep (different PIDs), which `withCardLock` cannot see
 *     because both racers there would be the same PID;
 *   - `withCardLock` serializes overlapping RMW within one server process.
 * The status is re-checked AFTER both locks are held, so a loser reads the
 * winner's committed status and is rejected rather than clobbering it.
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { stageAndCommitPaths, unstageFiles } from "../../lib/git.js";
import { toRelativePath, isCardFile } from "../../lib/paths.js";
import { withCardLock } from "../../lib/card-lock.js";
import { acquireLock, releaseLock, LockHeldError } from "../../lib/file-lock.js";
import { cardFields, parseCardText } from "../card-io.js";
import { errorMessage, errnoCode } from "../../lib/error-guards.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import {
  QuestionSchema,
  type QuestionFields,
  type QuestionStatusType,
} from "../../schemas/question.js";
import type { CommandContext, CommandResult } from "../command-runner.js";

const LOCK_RETRIES = 50;
const LOCK_RETRY_MS = 100;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Thrown when the cross-process question lock stays held past the retry budget.
 * Infrastructure failure, not a caller-actionable condition — `runCommand`
 * catches it into a `{ success: false }` result.
 */
export class QuestionLockError extends Error {
  readonly lockPath: string;
  constructor(lockPath: string) {
    super(`Question transition lock could not be acquired: ${lockPath}`);
    this.name = "QuestionLockError";
    this.lockPath = lockPath;
  }
}

/** A file the transition writes, committed together with the others. */
export interface TransitionWrite {
  /** Absolute path of the file to write. */
  absPath: string;
  /** New content to write. */
  content: string;
}

/** The mutation a caller wants applied inside the guarded critical section. */
export interface TransitionPlan {
  writes: TransitionWrite[];
  commit: { message: string; trailers?: Record<string, string> };
}

/**
 * Produces the concrete writes/commit for a loaded, status-checked question, or
 * short-circuits with a failure result (e.g. an unresolvable answer). Runs
 * INSIDE both locks with the freshly re-read card.
 */
export type PlanFn = (
  input: { fields: QuestionFields; content: string }
) => Promise<{ ok: true; plan: TransitionPlan } | { ok: false; result: CommandResult }>;

export interface WithQuestionTransitionParams {
  ctx: CommandContext;
  /** Absolute path to the question card. */
  fullPath: string;
  /** The caller-facing reference (for error messages). */
  questionRef: string;
  /** Statuses from which this transition is permitted. */
  allowedStatuses: readonly QuestionStatusType[];
  /** Message when the re-read status is outside `allowedStatuses`. */
  disallowedMessage: (status: QuestionStatusType) => string;
  plan: PlanFn;
}

export type TransitionResult =
  | { ok: true; fields: QuestionFields; committedPaths: string[] }
  | { ok: false; result: CommandResult };

/**
 * Resolve a caller-supplied question reference to an absolute path and its
 * box-relative form, FAIL-CLOSED on any path that escapes the box. Both the
 * `answer` and `dismiss` commands accept a path and join it with `boxRoot`; an
 * absolute path or a `../` segment would otherwise reach an arbitrary file on
 * disk. A CLI caller may pass an absolute path as long as it resolves INSIDE
 * the box (`toRelativePath` returns non-null); the web tRPC boundary rejects
 * absolute paths earlier, before ever reaching here.
 */
export function resolveContainedQuestionPath(
  boxRoot: string,
  question: string
): { ok: true; fullPath: string; relativePath: string } | { ok: false; error: string } {
  const fullPath = path.isAbsolute(question) ? question : path.join(boxRoot, question);
  if (!isCardFile(fullPath)) {
    return { ok: false, error: "Path must be a card file (*.card)" };
  }
  const relativePath = toRelativePath(boxRoot, fullPath);
  if (relativePath === null) {
    return { ok: false, error: `Question path escapes the box: ${question}` };
  }
  return { ok: true, fullPath, relativePath };
}

function questionLockPath(boxRoot: string, fullPath: string): string {
  // `.callback-box/` is gitignored ephemeral state, the right home for a
  // cross-process lock file (never committed, never validated). One lock per
  // card, keyed by a filesystem-safe encoding of its box-relative path.
  const rel = path.relative(boxRoot, fullPath);
  const safe = rel.replace(/[^\w.-]/g, "__");
  return path.join(boxRoot, ".callback-box", "question-locks", `${safe}.lock`);
}

/**
 * Load, parse, and schema-validate the question card, then re-check its status
 * against `allowedStatuses`. Runs inside the locks so the check reflects the
 * latest committed state.
 */
async function loadForTransition(
  params: {
    fullPath: string;
    questionRef: string;
    allowedStatuses: readonly QuestionStatusType[];
    disallowedMessage: (status: QuestionStatusType) => string;
  }
): Promise<
  { ok: true; fields: QuestionFields; content: string } | { ok: false; result: CommandResult }
> {
  const { fullPath, questionRef, allowedStatuses, disallowedMessage } = params;

  let content: string;
  try {
    content = await fs.readFile(fullPath, "utf-8");
  } catch (e) {
    console.warn(`Could not load card ${fullPath}:`, e);
    return { ok: false, result: { success: false, error: `Could not load card: ${questionRef}` } };
  }

  let fields: QuestionFields;
  try {
    const card = parseCardText(content, { source: fullPath, schemas: await createCardSchemaMap() });
    if (card.schema.type !== "question") {
      return {
        ok: false,
        result: { success: false, error: `Not a question card (got ${card.schema.type})` },
      };
    }
    fields = cardFields(card, QuestionSchema);
  } catch (err) {
    return {
      ok: false,
      result: { success: false, error: `Could not parse question: ${errorMessage(err)}` },
    };
  }

  if (!allowedStatuses.includes(fields.status)) {
    return { ok: false, result: { success: false, error: disallowedMessage(fields.status) } };
  }

  return { ok: true, fields, content };
}

/**
 * Apply the plan's writes, then commit them all in ONE commit. On commit
 * failure, restore every touched file to its pre-write state (or delete files
 * that didn't exist before) AND unstage the paths, so the transition is atomic
 * with respect to the commit and the question stays retryable.
 *
 * WRITE ORDER IS LOAD-BEARING: `plan.writes` are applied in array order, so a
 * caller MUST list any companion file (e.g. the answer's follow-up job) BEFORE
 * the status-flipped question card. The card's `status` flip is the commit
 * point; the companion must already exist on disk when it lands. A crash
 * between writes then leaves companion+pending-question (harmless, recoverable —
 * answering again just creates a second job) instead of the unrecoverable
 * answered-card-with-no-job state.
 */
async function applyAndCommit(
  { ctx, questionRef }: { ctx: CommandContext; questionRef: string },
  plan: TransitionPlan
): Promise<{ ok: true; committedPaths: string[] } | { ok: false; result: CommandResult }> {
  // Snapshot originals before writing, so a failed commit rolls back cleanly.
  const backups: Array<{ absPath: string; original: string | null }> = [];
  for (const write of plan.writes) {
    let original: string | null;
    try {
      original = await fs.readFile(write.absPath, "utf-8");
    } catch (e) {
      if (errnoCode(e) === "ENOENT") {
        original = null;
      } else {
        throw e;
      }
    }
    backups.push({ absPath: write.absPath, original });
  }

  for (const write of plan.writes) {
    await fs.mkdir(path.dirname(write.absPath), { recursive: true });
    await fs.writeFile(write.absPath, write.content);
  }

  const committedPaths = plan.writes.map((w) => path.relative(ctx.boxRoot, w.absPath));

  let commitHash: string | null;
  try {
    commitHash = await stageAndCommitPaths(ctx.boxRoot, {
      paths: committedPaths,
      message: plan.commit.message,
      ...(plan.commit.trailers !== undefined && { trailers: plan.commit.trailers }),
    });
  } catch (err) {
    // Roll back: the filesystem writes are not atomic with the commit, so a
    // failed commit must not leave a mutated card on disk that rejects retries.
    // Unstage first — stageAndCommitPaths stages before committing, so on
    // failure the paths sit in the index; leaving them staged would let a later
    // unrelated commit sweep up this transition's half-applied writes.
    try {
      await unstageFiles(ctx.boxRoot, committedPaths);
    } catch (e) {
      // Best-effort: if the commit failed because there's no repo (or the index
      // is unreadable), there's nothing staged to undo — the working-tree
      // restore below is what keeps the card retryable. Never let cleanup mask
      // the original commit failure.
      console.warn(`Question transition rollback: could not unstage paths in ${ctx.boxRoot}:`, e);
    }
    for (const backup of backups) {
      if (backup.original === null) {
        await fs.rm(backup.absPath, { force: true });
      } else {
        await fs.writeFile(backup.absPath, backup.original);
      }
    }
    return {
      ok: false,
      result: { success: false, error: `Failed to commit transition: ${errorMessage(err)}` },
    };
  }

  if (commitHash === null) {
    // stageAndCommitPaths returns null when the paths showed no changes (a
    // concurrent sweep already committed them). Unexpected for a guarded
    // transition that just wrote a status flip — surface it rather than
    // silently reporting success on a commit that didn't happen here.
    console.warn(
      `Question transition committed nothing (paths already committed by another process?) — box=${ctx.boxRoot}, card=${questionRef}`
    );
  }

  return { ok: true, committedPaths };
}

/**
 * Run a guarded question status transition: acquire the cross-process lock
 * (bounded retry while another process holds it), then the in-process card
 * lock, re-check status, apply the plan's writes, and commit them atomically
 * with rollback on failure.
 */
export async function withQuestionTransition(
  params: WithQuestionTransitionParams
): Promise<TransitionResult> {
  const { ctx, fullPath, questionRef, allowedStatuses, disallowedMessage, plan } = params;
  const lockPath = questionLockPath(ctx.boxRoot, fullPath);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
    try {
      await acquireLock(lockPath, { purpose: "question-transition", card: questionRef });
    } catch (e) {
      if (e instanceof LockHeldError) {
        await delay(LOCK_RETRY_MS);
        continue;
      }
      throw e;
    }
    try {
      return await withCardLock(fullPath, async (): Promise<TransitionResult> => {
        const loaded = await loadForTransition({
          fullPath,
          questionRef,
          allowedStatuses,
          disallowedMessage,
        });
        if (!loaded.ok) return loaded;

        const planned = await plan({ fields: loaded.fields, content: loaded.content });
        if (!planned.ok) return { ok: false, result: planned.result };

        const applied = await applyAndCommit({ ctx, questionRef }, planned.plan);
        if (!applied.ok) return applied;

        return { ok: true, fields: loaded.fields, committedPaths: applied.committedPaths };
      });
    } finally {
      await releaseLock(lockPath);
    }
  }
  throw new QuestionLockError(lockPath);
}
