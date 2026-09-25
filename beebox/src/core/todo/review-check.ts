/**
 * `bbx engine todo-review check` — the precheck of the stock `todo-review`
 * procedure (`docs/plans/todos-ui.md`, Track 7).
 *
 * Computes the sweep's sets (`review-sweep.ts`), saves the items in the sweep
 * state (`review-state.ts`) for the validate step (`review-verify.ts`), and
 * returns the brief the procedure's agent works from: the review instructions
 * (`TODO_REVIEW_INSTRUCTIONS`, shared with the legacy job card) and the three
 * lists. The brief reaches the agent as the precheck's output
 * (`pass-output`); no job card is written, so the wakeup reactor has nothing
 * to pick up and two agents never work one review. A legacy `todo-review`
 * job card still pending on a box is the reactor's to drain, not this.
 *
 * Each item carries a snapshot of the todo (status, assigned, start, due) so
 * `verify` can tell what the agent changed on a boxholder's todo.
 *
 * It also prunes the recheck history: entries whose card is gone, or whose
 * words no longer match any todo on that card, are dropped.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { stringify } from "yaml";
import { errnoCode } from "../../lib/error-guards.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import { TODO_REVIEW_INSTRUCTIONS } from "../../schemas/todo-review-job.js";
import { extractCardTodos } from "./extract.js";
import { formatTodoLocation } from "./collect-types.js";
import {
  loadSweepState,
  recheckKeyParts,
  saveSweepState,
  withSweepLock,
  type RecheckRecord,
  type ReviewItem,
} from "./review-state.js";
import { boxTodayEpoch, computeTodoReviewSets, toBriefItem, type SweptTodo, type TodoReviewSets } from "./review-sweep.js";

export type TodoReviewCheckResult = { kind: "nothing" } | { kind: "review"; brief: string; items: ReviewItem[] };

const KINDS = ["escalated", "stirring", "stale"] as const;

function reviewItem(todo: SweptTodo): ReviewItem {
  return {
    path: todo.path,
    locator: todo.locator,
    text: todo.text,
    status: todo.status,
    ...(todo.assigned !== undefined && { assigned: todo.assigned }),
    ...(todo.start !== undefined && { start: todo.start }),
    ...(todo.due !== undefined && { due: todo.due }),
  };
}

/** One item per todo, even when a todo sits in two lists. */
function reviewItems(sets: TodoReviewSets): ReviewItem[] {
  const seen = new Set<string>();
  const items: ReviewItem[] = [];
  for (const kind of KINDS) {
    for (const todo of sets[kind]) {
      const location = formatTodoLocation(todo);
      if (seen.has(location)) continue;
      seen.add(location);
      items.push(reviewItem(todo));
    }
  }
  return items;
}

function renderBrief(sets: TodoReviewSets, todayEpoch: number): string {
  const lists: Record<string, unknown> = {};
  for (const kind of KINDS) {
    if (sets[kind].length > 0) lists[kind] = sets[kind].map((t) => toBriefItem(t, kind));
  }
  const today = new Date(todayEpoch).toISOString().slice(0, 10);
  return `${TODO_REVIEW_INSTRUCTIONS}\n\nToday (box-local) is ${today}.\n\n## The items\n\n\`\`\`yaml\n${stringify(lists, { lineWidth: 0 })}\`\`\``;
}

/** The todo texts on `relPath`, or `null` when the card is gone. */
async function cardTexts(
  boxRoot: string,
  input: { relPath: string; cardSchemas: Awaited<ReturnType<typeof createCardSchemaMap>> },
): Promise<Set<string> | null> {
  let content: string;
  try {
    content = await fs.readFile(path.join(boxRoot, input.relPath), "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
  const { items } = extractCardTodos({ relPath: input.relPath, content, ctx: { cardSchemas: input.cardSchemas } });
  return new Set(items.map((t) => t.text));
}

/** `rechecks` without entries for cards that are gone or todos whose words no longer appear on their card. */
async function pruneRechecks(boxRoot: string, rechecks: Record<string, RecheckRecord>): Promise<Record<string, RecheckRecord>> {
  const cardSchemas = await createCardSchemaMap(boxRoot);
  const texts = new Map<string, Set<string> | null>();
  const kept: Record<string, RecheckRecord> = {};
  for (const [key, record] of Object.entries(rechecks)) {
    const parts = recheckKeyParts(key);
    if (parts === null) continue;
    if (!texts.has(parts.path)) texts.set(parts.path, await cardTexts(boxRoot, { relPath: parts.path, cardSchemas }));
    if (texts.get(parts.path)?.has(parts.text) === true) kept[key] = record;
  }
  return kept;
}

/**
 * Sweep, save the items, and return the brief (or `nothing`). The stirring
 * baseline moves here only when there is nothing to review; otherwise
 * `verify` moves it to `sweptOn` once every item is settled, so a run that
 * never finishes does not lose a newly stirring todo.
 */
export async function checkTodoReview(boxRoot: string): Promise<TodoReviewCheckResult> {
  return withSweepLock(boxRoot, async () => {
    const todayEpoch = await boxTodayEpoch(boxRoot);
    const state = await loadSweepState(boxRoot);
    const rechecks = await pruneRechecks(boxRoot, state.rechecks);
    // First run: everything already on the plate counts as "crossed since the box existed".
    const sets = await computeTodoReviewSets(boxRoot, { lastSweepEpoch: state.lastSweepDateEpoch ?? 0, todayEpoch });
    const items = reviewItems(sets);
    if (items.length === 0) {
      await saveSweepState(boxRoot, { lastSweepDateEpoch: todayEpoch, review: null, rechecks });
      return { kind: "nothing" };
    }
    await saveSweepState(boxRoot, { ...state, review: { sweptOn: todayEpoch, items }, rechecks });
    return { kind: "review", brief: renderBrief(sets, todayEpoch), items };
  });
}
