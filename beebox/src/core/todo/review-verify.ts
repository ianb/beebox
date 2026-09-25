/**
 * `bbx engine todo-review verify` — the validate phase of the stock
 * `todo-review` procedure (`docs/plans/todos-ui.md`, Track 7). It judges the
 * items `check` saved in the sweep state (`review-check.ts`).
 *
 * Every item must end settled:
 * - its status is no longer `open` (the agent's own todos only);
 * - or it carries a `recheck` date 1 to 90 days after today (box-local).
 *
 * On a **boxholder's** todo (saved `assigned` is not `agent`), `recheck` is
 * the only thing the review may change. The todo is found again by the words
 * `check` saved (the locator only breaks ties, since an edit elsewhere on the
 * card moves line numbers), so a reworded or removed boxholder todo is not
 * found and fails; a change to any other attribute (`review-snapshot.ts`:
 * everything but `recheck`, plus nested `see-also`) fails and names them.
 * The note after the closing tag may change: that is where the reason goes. On the agent's own todo, a reword or removal counts
 * as tending it.
 *
 * Anything unsettled is reported, and the procedure re-invokes the agent with
 * the list (`severity: review`). When every item is settled, the stirring
 * baseline moves to the day `check` swept.
 *
 * **Retirement.** Each settling recheck is recorded per todo (card path +
 * text) in the sweep state. When a todo gets its THIRD recheck while its
 * status, `start`, and `due` are unchanged since the previous one, verify
 * rewrites that recheck to `never` and commits "Stop reviewing todo: …". The
 * todo then leaves the review for good and shows in the `todos-unreviewed`
 * health warning. Any edit to the todo (its words are the key; status, start,
 * due are compared) restarts the count.
 *
 * `recheck="never"` is never a valid agent answer: it passes only when this
 * review's own verify wrote it (`check` clears older retired records for the
 * todos it lists). A refused `never` is flagged in the history so it does not
 * keep the todo out of the next review. The retirement records where the todo
 * was and its snapshot; `check` treats a retired todo that no longer matches
 * as back in review (`review-retired.ts`).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { withCardLock } from "../../lib/card-lock.js";
import { writeFileAtomic } from "../../lib/atomic-write.js";
import { stageAndCommitPaths } from "../../lib/git.js";
import { errnoCode, errorMessage } from "../../lib/error-guards.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import { parseRecheck, RECHECK_NEVER, TODO_AGENT } from "../../shared/todo-model.js";
import { extractCardTodos } from "./extract.js";
import { formatTodoLocation, type TodoItem } from "./collect-types.js";
import { setTodoAttribute } from "./set-status.js";
import { changedSince, snapshotOf } from "./review-snapshot.js";
import { loadSweepState, recheckKey, saveSweepState, withSweepLock, type RecheckRecord, type ReviewItem } from "./review-state.js";
import { boxTodayEpoch } from "./review-sweep.js";

/** Rechecks on an unchanged todo before verify retires it. Plan: tune after a month on a field box. */
const RETIRE_AFTER_RECHECKS = 3;
/** The furthest out a review may push a todo. */
const MAX_RECHECK_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const COMMIT_TEXT_MAX = 60;

/** Thrown when `verify` runs with no review saved by `check`. */
export class TodoReviewNotCheckedError extends Error {
  constructor() {
    super("No todo review to verify: run `bbx engine todo-review check` first");
    this.name = "TodoReviewNotCheckedError";
  }
}

export interface TodoReviewVerifyResult {
  /** Items not settled, each with why. */
  unsettled: Array<{ item: ReviewItem; reason: string }>;
  /** Todos this run retired to `recheck="never"`. */
  retired: ReviewItem[];
}

type ItemVerdict = { settled: true; recheck: string | null } | { settled: false; reason: string };

function isoDay(epoch: number): string {
  return new Date(epoch).toISOString().slice(0, 10);
}

/** The todo `item` addresses as it reads now, or `null` when its card or its words are gone. */
async function findCurrent(
  boxRoot: string,
  input: { item: ReviewItem; cardSchemas: Awaited<ReturnType<typeof createCardSchemaMap>> },
): Promise<TodoItem | null> {
  const { item, cardSchemas } = input;
  let content: string;
  try {
    content = await fs.readFile(path.join(boxRoot, item.path), "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
  const { items } = extractCardTodos({ relPath: item.path, content, ctx: { cardSchemas } });
  const sameText = items.filter((t) => t.text === item.text);
  const wanted = formatTodoLocation(item);
  return sameText.find((t) => formatTodoLocation(t) === wanted) ?? sameText[0] ?? null;
}

/** Why this boxholder todo's review broke the recheck-only rule, or `null` when it didn't. */
function boxholderEditProblem(item: ReviewItem, todo: TodoItem | null): string | null {
  if (item.snapshot.assigned === TODO_AGENT) return null;
  if (todo === null) return "not found on its card as written: the review may not reword the boxholder's todos";
  const changed = changedSince(item.snapshot, todo);
  if (changed.length === 0) return null;
  return `the review may change only recheck on the boxholder's todos (changed: ${changed.join(", ")})`;
}

function judge(input: { todo: TodoItem; record: RecheckRecord | undefined; todayEpoch: number }): ItemVerdict {
  const { todo, record, todayEpoch } = input;
  if (todo.status !== "open") return { settled: true, recheck: null };
  const parsed = parseRecheck(todo.recheck);
  if (parsed === null) {
    return {
      settled: false,
      reason: todo.recheck === undefined ? "still open with no recheck date" : `recheck "${todo.recheck}" is not a date`,
    };
  }
  if (parsed === RECHECK_NEVER) {
    // `check` cleared any older retired record for a listed todo, so one here
    // was written by this review's own verify.
    if (record?.retired !== undefined) return { settled: true, recheck: null };
    return { settled: false, reason: 'recheck="never" is set only by the review itself; give a date 1-90 days out' };
  }
  const days = Math.round((parsed - todayEpoch) / MS_PER_DAY);
  if (days < 1 || days > MAX_RECHECK_DAYS) {
    return {
      settled: false,
      reason: `recheck ${todo.recheck ?? ""} is ${String(days)} days from today (${isoDay(todayEpoch)}); it must be 1-${String(MAX_RECHECK_DAYS)} days out`,
    };
  }
  return { settled: true, recheck: todo.recheck ?? null };
}

/** The history entry after counting `recheck` on `todo`, or the old one when that recheck was already counted. */
function countRecheck(input: { todo: TodoItem; recheck: string; record: RecheckRecord | undefined }): RecheckRecord {
  const { todo, recheck, record } = input;
  if (record?.recheck === recheck) return record;
  // A retired todo that is back in review had its `never` removed by someone:
  // that is tending it, so its count starts over.
  const unchanged =
    record !== undefined &&
    record.retired === undefined &&
    record.status === todo.status &&
    record.start === todo.start &&
    record.due === todo.due;
  return {
    status: todo.status,
    ...(todo.start !== undefined && { start: todo.start }),
    ...(todo.due !== undefined && { due: todo.due }),
    recheck,
    count: unchanged ? record.count + 1 : 1,
  };
}

function rejectNever(todo: TodoItem, record: RecheckRecord | undefined): RecheckRecord {
  return {
    status: todo.status,
    ...(todo.start !== undefined && { start: todo.start }),
    ...(todo.due !== undefined && { due: todo.due }),
    recheck: RECHECK_NEVER,
    count: record?.count ?? 0,
    neverRejected: true,
  };
}

/** Rewrite the todo's `recheck` to `never` and commit, under the card lock. Refuses if the todo moved or changed meanwhile. */
async function retire(boxRoot: string, todo: TodoItem): Promise<boolean> {
  const fullPath = path.join(boxRoot, todo.path);
  return withCardLock(fullPath, async () => {
    const content = await fs.readFile(fullPath, "utf-8");
    const cardSchemas = await createCardSchemaMap(boxRoot);
    const { items } = extractCardTodos({ relPath: todo.path, content, ctx: { cardSchemas } });
    const wanted = formatTodoLocation(todo);
    const current = items.find((t) => formatTodoLocation(t) === wanted);
    if (current?.text !== todo.text || current.recheck !== todo.recheck) {
      console.warn(`todo-review verify: ${wanted} changed while retiring it; left as is`);
      return false;
    }
    await writeFileAtomic(fullPath, {
      content: setTodoAttribute(content, { locator: todo.locator, name: "recheck", value: RECHECK_NEVER }),
    });
    const short = todo.text.length > COMMIT_TEXT_MAX ? `${todo.text.slice(0, COMMIT_TEXT_MAX - 1)}…` : todo.text;
    try {
      await stageAndCommitPaths(boxRoot, {
        paths: [todo.path],
        message: `Stop reviewing todo: ${short}`,
        trailers: { "Created-By": "todo-review-verify" },
      });
    } catch (e) {
      // The edit is on disk; the procedure's git-clean step commits it.
      console.warn(`todo-review verify: retired ${wanted} but could not commit: ${errorMessage(e)}`);
    }
    return true;
  });
}

/** Judge every saved item, record rechecks, and retire todos on their third unchanged recheck. */
export async function verifyTodoReview(boxRoot: string): Promise<TodoReviewVerifyResult> {
  return withSweepLock(boxRoot, async () => {
    const state = await loadSweepState(boxRoot);
    if (state.review === null) throw new TodoReviewNotCheckedError();
    const todayEpoch = await boxTodayEpoch(boxRoot);
    const cardSchemas = await createCardSchemaMap(boxRoot);
    const rechecks = { ...state.rechecks };
    const result: TodoReviewVerifyResult = { unsettled: [], retired: [] };

    for (const item of state.review.items) {
      const todo = await findCurrent(boxRoot, { item, cardSchemas });
      const problem = boxholderEditProblem(item, todo);
      if (problem !== null) {
        result.unsettled.push({ item, reason: problem });
        continue;
      }
      if (todo === null) continue; // the agent's own todo, reworded or removed: it tended it
      const key = recheckKey(todo);
      const verdict = judge({ todo, record: rechecks[key], todayEpoch });
      if (!verdict.settled) {
        result.unsettled.push({ item, reason: verdict.reason });
        // A `never` the agent wrote must not keep the todo out of the next review.
        if (todo.recheck === RECHECK_NEVER) rechecks[key] = rejectNever(todo, rechecks[key]);
        continue;
      }
      if (verdict.recheck === null) continue;
      const record = countRecheck({ todo, recheck: verdict.recheck, record: rechecks[key] });
      rechecks[key] = record;
      if (record.count >= RETIRE_AFTER_RECHECKS && (await retire(boxRoot, todo))) {
        rechecks[key] = {
          ...record,
          recheck: RECHECK_NEVER,
          retired: { on: isoDay(todayEpoch), locator: todo.locator, snapshot: snapshotOf(todo) },
        };
        result.retired.push(item);
      }
    }

    const settled = result.unsettled.length === 0;
    await saveSweepState(boxRoot, {
      ...state,
      rechecks,
      ...(settled && state.review.sweptOn !== null && { lastSweepDateEpoch: state.review.sweptOn }),
    });
    return result;
  });
}
