/**
 * `bbx engine todo-review check` — the precheck of the stock `todo-review`
 * procedure (`docs/plans/todos-ui.md`, Track 7).
 *
 * Computes the sweep's sets (`review-sweep.ts`), saves the items in the sweep
 * state (`review-state.ts`) for the validate step (`review-verify.ts`), and
 * returns the brief the procedure's agent works from: the review instructions
 * (`TODO_REVIEW_INSTRUCTIONS`, shared with the legacy job card) and the three
 * lists. The brief reaches the agent as the precheck's output
 * (`pass-output`), at most 25 items per run; no job card is written, so the wakeup reactor has nothing
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

/** Most items one brief carries; the rest stay eligible and come in later runs. */
const MAX_ITEMS = 25;

type Kind = (typeof KINDS)[number];

interface Selection {
  shown: Array<{ kind: Kind; todo: SweptTodo }>;
  /** Todos across all lists, one per todo. */
  total: number;
  /** A stirring todo was cut: the baseline must not move past it. */
  cutStirring: boolean;
}

/** Ascending by an ISO date attribute, undated last, then by location. */
function byDate(attr: "due" | "start" | "created"): (a: SweptTodo, b: SweptTodo) => number {
  return (a, b) => {
    const x = a[attr];
    const y = b[attr];
    if (x !== y) {
      if (x === undefined) return 1;
      if (y === undefined) return -1;
      return x < y ? -1 : 1;
    }
    return formatTodoLocation(a).localeCompare(formatTodoLocation(b));
  };
}

const ORDER: Record<Kind, (a: SweptTodo, b: SweptTodo) => number> = {
  escalated: byDate("due"),
  stirring: byDate("start"),
  stale: byDate("created"),
};

/**
 * One entry per todo (a todo in two lists keeps its first), in priority
 * order — escalated by oldest `due`, then stirring, then stale by oldest
 * `created` — capped at {@link MAX_ITEMS}. A cut todo gets no new `recheck`,
 * so the next run lists it again.
 */
function selectItems(sets: TodoReviewSets): Selection {
  const seen = new Set<string>();
  const all: Array<{ kind: Kind; todo: SweptTodo }> = [];
  for (const kind of KINDS) {
    for (const todo of sets[kind].toSorted(ORDER[kind])) {
      const location = formatTodoLocation(todo);
      if (seen.has(location)) continue;
      seen.add(location);
      all.push({ kind, todo });
    }
  }
  const cutStirring = all.slice(MAX_ITEMS).some((entry) => entry.kind === "stirring");
  return { shown: all.slice(0, MAX_ITEMS), total: all.length, cutStirring };
}

function renderBrief(selection: Selection, todayEpoch: number): string {
  const lists: Record<string, unknown> = {};
  for (const kind of KINDS) {
    const items = selection.shown.filter((entry) => entry.kind === kind).map((entry) => toBriefItem(entry.todo, kind));
    if (items.length > 0) lists[kind] = items;
  }
  const today = new Date(todayEpoch).toISOString().slice(0, 10);
  const shown = selection.shown.length;
  const cap =
    selection.total > shown ? `${String(shown)} of ${String(selection.total)} shown; the rest come in later runs.\n\n` : "";
  return `${TODO_REVIEW_INSTRUCTIONS}\n\nToday (box-local) is ${today}.\n\n## The items\n\n${cap}\`\`\`yaml\n${stringify(lists, { lineWidth: 0 })}\`\`\``;
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
 * never finishes does not lose a newly stirring todo. When the 25-item cap
 * cut a stirring todo, `sweptOn` is `null` and the baseline stays put.
 */
export async function checkTodoReview(boxRoot: string): Promise<TodoReviewCheckResult> {
  return withSweepLock(boxRoot, async () => {
    const todayEpoch = await boxTodayEpoch(boxRoot);
    const state = await loadSweepState(boxRoot);
    const rechecks = await pruneRechecks(boxRoot, state.rechecks);
    // First run: everything already on the plate counts as "crossed since the box existed".
    const sets = await computeTodoReviewSets(boxRoot, { lastSweepEpoch: state.lastSweepDateEpoch ?? 0, todayEpoch });
    const selection = selectItems(sets);
    if (selection.total === 0) {
      await saveSweepState(boxRoot, { lastSweepDateEpoch: todayEpoch, review: null, rechecks });
      return { kind: "nothing" };
    }
    const items = selection.shown.map((entry) => reviewItem(entry.todo));
    // A stirring todo the cap cut was never shown: the baseline must not move past it.
    const sweptOn = selection.cutStirring ? null : todayEpoch;
    await saveSweepState(boxRoot, { ...state, review: { sweptOn, items }, rechecks });
    return { kind: "review", brief: renderBrief(selection, todayEpoch), items };
  });
}
