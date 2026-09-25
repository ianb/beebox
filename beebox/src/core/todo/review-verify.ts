/**
 * `bbx engine todo-review verify <job>` — the validate phase of the stock
 * `todo-review` procedure (`docs/plans/todos-ui.md`, Track 7).
 *
 * Every item of the job must end settled:
 * - its status is no longer `open`;
 * - or it carries a `recheck` date 1 to 90 days after today (box-local);
 * - or its words changed, or its card is gone — someone edited it, which is
 *   tending it. A todo is found again by its words on its card (the locator is
 *   only a tie-break), since an edit elsewhere on the card moves line numbers
 *   without changing what the todo is.
 *
 * Anything else is reported, and the procedure re-invokes the agent with the
 * list (`severity: review`).
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
 * step wrote it.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { withCardLock } from "../../lib/card-lock.js";
import { writeFileAtomic } from "../../lib/atomic-write.js";
import { stageAndCommitPaths } from "../../lib/git.js";
import { errnoCode, errorMessage } from "../../lib/error-guards.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import { parseRecheck, RECHECK_NEVER } from "../../shared/todo-model.js";
import { extractCardTodos } from "./extract.js";
import { formatTodoLocation, type TodoItem } from "./collect-types.js";
import { setTodoAttribute } from "./set-status.js";
import { loadSweepState, recheckKey, saveSweepState, withSweepLock, type RecheckRecord, type ReviewItem } from "./review-state.js";
import { boxTodayEpoch } from "./review-sweep.js";

/** Rechecks on an unchanged todo before verify retires it. Plan: tune after a month on a field box. */
const RETIRE_AFTER_RECHECKS = 3;
/** The furthest out a review may push a todo. */
const MAX_RECHECK_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const COMMIT_TEXT_MAX = 60;

/** Thrown when `verify` is asked about a job `check` never handed out. */
export class TodoReviewJobUnknownError extends Error {
  constructor(jobPath: string, recorded: string | null) {
    super(
      `No todo-review snapshot for ${jobPath}` +
        (recorded === null ? " (run `bbx engine todo-review check` first)" : ` (the last checked job is ${recorded})`),
    );
    this.name = "TodoReviewJobUnknownError";
  }
}

export interface TodoReviewVerifyResult {
  /** Job items still open with no acceptable `recheck`, each with why. */
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
    if (record?.retiredOn !== undefined) return { settled: true, recheck: null };
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
    record.retiredOn === undefined &&
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

/** Judge every item of `jobPath`, record rechecks, and retire todos on their third unchanged recheck. */
export async function verifyTodoReview(boxRoot: string, jobPath: string): Promise<TodoReviewVerifyResult> {
  return withSweepLock(boxRoot, async () => {
    const state = await loadSweepState(boxRoot);
    if (state.job?.path !== jobPath) throw new TodoReviewJobUnknownError(jobPath, state.job?.path ?? null);
    const todayEpoch = await boxTodayEpoch(boxRoot);
    const cardSchemas = await createCardSchemaMap(boxRoot);
    const rechecks = { ...state.rechecks };
    const result: TodoReviewVerifyResult = { unsettled: [], retired: [] };

    for (const item of state.job.items) {
      const todo = await findCurrent(boxRoot, { item, cardSchemas });
      if (todo === null) continue; // edited or removed: someone tended it
      const key = recheckKey(todo);
      const verdict = judge({ todo, record: rechecks[key], todayEpoch });
      if (!verdict.settled) {
        result.unsettled.push({ item, reason: verdict.reason });
        continue;
      }
      if (verdict.recheck === null) continue;
      const record = countRecheck({ todo, recheck: verdict.recheck, record: rechecks[key] });
      rechecks[key] = record;
      if (record.count >= RETIRE_AFTER_RECHECKS && (await retire(boxRoot, todo))) {
        rechecks[key] = { ...record, recheck: RECHECK_NEVER, retiredOn: isoDay(todayEpoch) };
        result.retired.push(item);
      }
    }

    await saveSweepState(boxRoot, { ...state, rechecks });
    return result;
  });
}
