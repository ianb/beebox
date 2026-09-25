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
 * Each item carries a snapshot of the todo (every attribute but `recheck`,
 * `review-snapshot.ts`) so `verify` can tell what the agent changed on a
 * boxholder's todo.
 *
 * A `recheck="never"` holds only when the boxholder set it, or when `verify`
 * retired the todo and it is unchanged since (`review-retired.ts`); a listed
 * todo's retired record is cleared, since it is re-entering review. The
 * recheck history is pruned of cards that are gone and todos whose words are.
 */

import { stringify } from "yaml";
import { TODO_REVIEW_INSTRUCTIONS } from "../../schemas/todo-review-job.js";
import { formatTodoLocation } from "./collect-types.js";
import { loadSweepState, saveSweepState, withSweepLock, type ReviewItem } from "./review-state.js";
import { clearRetired, loadHistoryCards, neverDefers, pruneRechecks } from "./review-retired.js";
import { snapshotOf } from "./review-snapshot.js";
import { boxTodayEpoch, computeTodoReviewSets, toBriefItem, type SweptTodo, type TodoReviewSets } from "./review-sweep.js";

export type TodoReviewCheckResult = { kind: "nothing" } | { kind: "review"; brief: string; items: ReviewItem[] };

const KINDS = ["escalated", "stirring", "stale"] as const;

function reviewItem(todo: SweptTodo): ReviewItem {
  return {
    path: todo.path,
    locator: todo.locator,
    text: todo.text,
    snapshot: snapshotOf(todo),
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
    const cards = await loadHistoryCards(boxRoot, state.rechecks);
    const sets = await computeTodoReviewSets(boxRoot, {
      // First run: everything already on the plate counts as "crossed since the box existed".
      lastSweepEpoch: state.lastSweepDateEpoch ?? 0,
      todayEpoch,
      neverDefers: (todo) => neverDefers({ rechecks: state.rechecks, cards, todo }),
    });
    const selection = selectItems(sets);
    // A listed todo is re-entering review: a retired record for it no longer holds.
    let history = state.rechecks;
    for (const { todo } of selection.shown) history = clearRetired({ rechecks: history, cards, todo });
    const rechecks = pruneRechecks({ rechecks: history, cards });
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
