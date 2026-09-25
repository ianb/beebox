/**
 * The todo-review's box-local state, `.beebox/todo-review-sweep.json`, and
 * the cross-process lock every reader-modifier-writer of it holds
 * (`docs/plans/todos-ui.md`, Track 7).
 *
 * Three things live here:
 * - `lastSweepDateEpoch` — the sweep's `stirring` baseline (`review-sweep.ts`).
 * - `review` — the items `bbx engine todo-review check` last handed to the
 *   procedure's agent, each an address (card path, locator, text) plus a
 *   snapshot of the attributes the agent may not change on a boxholder's
 *   todo. There is no job card: `verify` reads the items from here.
 * - `rechecks` — per-todo recheck history, keyed by card path + todo text,
 *   which is how `verify` counts unchanged rechecks and retires a todo on the
 *   third (`review-verify.ts`).
 *
 * The file is gitignored bookkeeping: losing it costs one baseline and the
 * recheck counts, never a todo.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { errnoCode } from "../../lib/error-guards.js";
import { writeFileAtomic } from "../../lib/atomic-write.js";
import { acquireLock, releaseLock, LockHeldError } from "../../lib/file-lock.js";
import { sleep } from "../../lib/sleep.js";
import { TodoLocatorSchema } from "../../shared/todo-locators.js";
import { TODO_STATUSES } from "../../shared/todo-model.js";

const SWEEP_STATE_PATH = ".beebox/todo-review-sweep.json";
const SWEEP_LOCK_PATH = ".beebox/todo-review-sweep.lock";
// Bounded retry against a concurrent holder (another check/verify, or a
// manual run) — generous enough to outlast a normal sweep's own runtime (a
// collector pass + one state write), short enough that a genuinely stuck
// holder fails loud rather than wedging the caller indefinitely.
const LOCK_RETRIES = 20;
const LOCK_RETRY_MS = 250;

/** Thrown when the sweep's cross-process lock stays held by another process for the whole retry budget. */
class TodoReviewSweepLockError extends Error {
  constructor(lockPath: string) {
    super(`Could not acquire the todo-review sweep lock at ${lockPath} — another process held it too long`);
    this.name = "TodoReviewSweepLockError";
  }
}

/**
 * One review item: an address `verify` can re-extract, and what the todo
 * looked like when `check` handed it out.
 */
const ReviewItemSchema = z.object({
  path: z.string(),
  locator: TodoLocatorSchema,
  text: z.string(),
  status: z.enum(TODO_STATUSES),
  assigned: z.string().optional(),
  start: z.string().optional(),
  due: z.string().optional(),
});

export type ReviewItem = z.infer<typeof ReviewItemSchema>;

/**
 * What a todo looked like the last time `verify` saw it given a recheck. A
 * later recheck counts toward retirement only when `status`, `start`, and
 * `due` still match (the text is part of the key).
 */
const RecheckRecordSchema = z.object({
  status: z.string(),
  start: z.string().optional(),
  due: z.string().optional(),
  /** The `recheck` value last counted, so a re-run of `verify` never counts the same recheck twice. */
  recheck: z.string(),
  count: z.number().int().min(0),
  /** Box-local ISO date on which `verify` set `recheck="never"`. */
  retiredOn: z.string().optional(),
});

export type RecheckRecord = z.infer<typeof RecheckRecordSchema>;

const SweepStateSchema = z.object({
  // A box-local calendar-date epoch (see `boxLocalDateEpoch`), stored as a
  // number, NOT a wall-clock ISO instant — `start`/`due` are calendar dates,
  // and comparing a calendar epoch against a wall-clock timestamp would
  // undercount a `start` dated earlier the same day a sweep happens to run
  // mid-afternoon.
  lastSweepDateEpoch: z.number().optional(),
  /** `sweptOn`: the box-local date epoch `check` computed the items for; `verify` moves the baseline to it once every item is settled. */
  review: z.object({ sweptOn: z.number(), items: z.array(ReviewItemSchema) }).optional(),
  rechecks: z.record(z.string(), RecheckRecordSchema).optional(),
});

export interface SweepState {
  lastSweepDateEpoch: number | null;
  review: { sweptOn: number; items: ReviewItem[] } | null;
  rechecks: Record<string, RecheckRecord>;
}

/** The `rechecks` key for one todo: its card and its words. */
export function recheckKey({ path: cardPath, text }: { path: string; text: string }): string {
  return JSON.stringify([cardPath, text]);
}

const RecheckKeySchema = z.tuple([z.string(), z.string()]);

/** The card path and todo text a `rechecks` key names, or `null` for a key this module did not write. */
export function recheckKeyParts(key: string): { path: string; text: string } | null {
  let json: unknown;
  try {
    json = JSON.parse(key);
  } catch (_e) {
    return null; // not a key recheckKey wrote; the caller drops it
  }
  const parsed = RecheckKeySchema.safeParse(json);
  return parsed.success ? { path: parsed.data[0], text: parsed.data[1] } : null;
}

export async function loadSweepState(boxRoot: string): Promise<SweepState> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(boxRoot, SWEEP_STATE_PATH), "utf-8");
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn("Could not read todo-review sweep state, treating as first run:", e);
    }
    return { lastSweepDateEpoch: null, review: null, rechecks: {} };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    console.warn("todo-review sweep state is not JSON, treating as first run:", e);
    return { lastSweepDateEpoch: null, review: null, rechecks: {} };
  }
  const parsed = SweepStateSchema.safeParse(json);
  if (!parsed.success) {
    console.warn(`todo-review sweep state has an unexpected shape, treating as first run: ${parsed.error.message}`);
    return { lastSweepDateEpoch: null, review: null, rechecks: {} };
  }
  const data = parsed.data;
  return { lastSweepDateEpoch: data.lastSweepDateEpoch ?? null, review: data.review ?? null, rechecks: data.rechecks ?? {} };
}

export async function saveSweepState(boxRoot: string, state: SweepState): Promise<void> {
  const absPath = path.join(boxRoot, SWEEP_STATE_PATH);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const data = {
    ...(state.lastSweepDateEpoch !== null && { lastSweepDateEpoch: state.lastSweepDateEpoch }),
    ...(state.review !== null && { review: state.review }),
    rechecks: state.rechecks,
  };
  await writeFileAtomic(absPath, { content: `${JSON.stringify(data, null, 2)}\n` });
}

/**
 * Run `fn` holding the standard cross-process lock (`file-lock.ts`) over the
 * sweep state, so two concurrent runs can't both load the same state, each
 * compute, and step on each other's write. Bounded retry against a live
 * holder, same shape as `withQuestionTransition`'s lock loop
 * (`core/commands/question-transition.ts`) — a genuinely stuck holder fails
 * loud rather than blocking the caller forever. Not reentrant: `fn` must not
 * call it again.
 */
export async function withSweepLock<T>(boxRoot: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = path.join(boxRoot, SWEEP_LOCK_PATH);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
    try {
      await acquireLock(lockPath, { purpose: "todo-review-sweep" });
    } catch (e) {
      if (e instanceof LockHeldError) {
        await sleep(LOCK_RETRY_MS);
        continue;
      }
      throw e;
    }
    try {
      return await fn();
    } finally {
      await releaseLock(lockPath);
    }
  }
  throw new TodoReviewSweepLockError(lockPath);
}
