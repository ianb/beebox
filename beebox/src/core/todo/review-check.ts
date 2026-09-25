/**
 * `bbx engine todo-review check` — the precheck of the stock `todo-review`
 * procedure (`docs/plans/todos-ui.md`, Track 7).
 *
 * Runs the sweep (`review-sweep.ts`) and settles which job the procedure's
 * agent is to process: the one the sweep just queued, or else the oldest
 * `todo-review` job still pending from an earlier run (which, on a box with
 * no wakeup schedule, nothing else would ever pick up). It records that
 * job's items as addresses in the sweep state (`review-state.ts`), because
 * `bbx finish` deletes the job card before the procedure's validate phase
 * (`review-verify.ts`) reads them.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { getBoxDir } from "../../lib/paths.js";
import { readCardFrontmatter } from "../card-io.js";
import { findJobCards } from "../reactor/job-discovery.js";
import { TodoReviewItemSchema } from "../../schemas/todo-review-job.js";
import { parseTodoLocation } from "./collect-types.js";
import { loadSweepState, saveSweepState, withSweepLock, type ReviewItem } from "./review-state.js";
import { runTodoReviewSweepLocked, TODO_REVIEW_JOB_SOURCE } from "./review-sweep.js";

/** Thrown when a `todo-review` job card cannot be read back into item addresses. */
export class TodoReviewJobUnreadableError extends Error {
  constructor(jobPath: string, reason: string) {
    super(`Cannot read todo-review job ${jobPath}: ${reason}`);
    this.name = "TodoReviewJobUnreadableError";
  }
}

export type TodoReviewCheckResult =
  | { kind: "nothing" }
  | { kind: "job"; jobPath: string; queued: boolean; items: ReviewItem[] };

const JobItemsSchema = z.object({
  escalated: z.array(TodoReviewItemSchema).default([]),
  stirring: z.array(TodoReviewItemSchema).default([]),
  stale: z.array(TodoReviewItemSchema).default([]),
});

/** The oldest pending `todo-review` job, box-relative, or `null`. */
async function oldestPendingJob(boxRoot: string): Promise<string | null> {
  const jobsDir = getBoxDir(boxRoot, "jobs");
  const pending = await findJobCards(jobsDir, { sourceFilter: TODO_REVIEW_JOB_SOURCE });
  const first = pending[0];
  return first === undefined ? null : path.relative(boxRoot, path.join(jobsDir, first.file));
}

/** A job card's items as addresses, in list order, one entry per todo even when it sits in two lists. */
async function readJobItems(boxRoot: string, jobPath: string): Promise<ReviewItem[]> {
  const content = await fs.readFile(path.join(boxRoot, jobPath), "utf-8");
  const parsed = JobItemsSchema.safeParse(readCardFrontmatter(content) ?? {});
  if (!parsed.success) throw new TodoReviewJobUnreadableError(jobPath, parsed.error.message);
  const items: ReviewItem[] = [];
  const seen = new Set<string>();
  for (const item of [...parsed.data.escalated, ...parsed.data.stirring, ...parsed.data.stale]) {
    const address = parseTodoLocation(item.locator);
    if (address === null) throw new TodoReviewJobUnreadableError(jobPath, `unrecognized locator "${item.locator}"`);
    if (seen.has(item.locator)) continue;
    seen.add(item.locator);
    items.push({ ...address, text: item.text });
  }
  return items;
}

/** Sweep, then name the job the procedure should process (or `nothing`). */
export async function checkTodoReview(boxRoot: string): Promise<TodoReviewCheckResult> {
  return withSweepLock(boxRoot, async () => {
    const sweep = await runTodoReviewSweepLocked(boxRoot);
    const jobPath = sweep.jobPath ?? (await oldestPendingJob(boxRoot));
    if (jobPath === null) return { kind: "nothing" };
    const items = await readJobItems(boxRoot, jobPath);
    const state = await loadSweepState(boxRoot);
    await saveSweepState(boxRoot, { ...state, job: { path: jobPath, items } });
    return { kind: "job", jobPath, queued: sweep.jobPath !== null, items };
  });
}
