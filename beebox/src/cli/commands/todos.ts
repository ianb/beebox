/**
 * `bbx todos` — read/query-only surface over the todo collection
 * (`docs/implemented-plans/todo-annotation.md` Track 3).
 *
 * **Superseded by `bbx query todos`** (`docs/plans/todo-collection.md`,
 * Track 4). It stays for now with its flags and its output unchanged, and is
 * scheduled for removal; the agent guide, the ambient line, and the knowledge
 * audits all teach `bbx query` instead. What changed underneath is that it
 * runs on the same collection runner as every other consumer, so there is one
 * code path rather than two that can disagree.
 *
 * Mutation is NOT a command here — an agent edits the `{% todo %}` tag or
 * frontmatter `todos:` entry directly (the normal card-edit path, with its
 * usual validation/git-history/lock guarantees).
 *
 * Parse/validate/load failures and duplicate-id collisions always print in
 * a trailing section (never silently dropped, per the plan's "todo
 * graveyard" concern) — even under `--json`, where they're the `issues`
 * array alongside the filtered `todos`.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { runTodoQuery } from "../../core/todo/query.js";
import type { DerivedTodo } from "../../core/todo/collection.js";
import { isTodoStatus, type TodoPlateState } from "../../shared/todo-model.js";
import { errorMessage } from "../../lib/error-guards.js";
import { formatIssues, formatTodoRow } from "./query-format.js";

interface TodosCliOptions {
  status?: string;
  assigned?: string;
  glob?: string;
  onPlate?: boolean;
  json?: boolean;
}

export const todosCommand = new Command("todos")
  .description("Query todos collected across the box (`{% todo %}` tags and frontmatter `todos:` entries)")
  .option("--status <status>", "Filter by status: open, done, dropped, parked (default: open)")
  .option("--assigned <name>", "Filter by the `assigned` attribute (exact match)")
  .option("--glob <pattern>", "Restrict which cards are scanned (default: every card)")
  .option("--on-plate", "Only escalated / on-plate todos (excludes quiet)")
  .option("--json", "Full structured records as JSON, `{todos, issues}`")
  .action(async (options: TodosCliOptions) => {
    try {
      const boxRoot = await requireBoxRoot();
      await runTodosForBox(boxRoot, options);
    } catch (error) {
      console.error(`Error: ${errorMessage(error)}`);
      process.exit(1);
    }
  });

/**
 * The command's logic, taking `boxRoot` directly rather than resolving it
 * from `process.cwd()` — the seam doctests drive (`test/cli/todos.doctest.md`),
 * same approach as `auth.ts`'s exported `run*` functions.
 */
export async function runTodosForBox(boxRoot: string, options: TodosCliOptions): Promise<void> {
  const status = options.status ?? "open";
  if (!isTodoStatus(status)) {
    console.error(`Error: --status must be one of open, done, dropped, parked (got "${status}")`);
    process.exit(1);
  }

  const result = await runTodoQuery(boxRoot, {
    query: {
      // The box, with the glob as the only scope control: this command never
      // had a `here`, so it must never pick up a reference pass either.
      here: "",
      ...(options.glob !== undefined && { glob: options.glob }),
      params: {
        status: [status],
        // The agent's own surface: it must see every todo it always has,
        // agent-assigned included, regardless of the boxholder-scope default
        // (Track 1).
        scope: "all",
        ...(options.assigned !== undefined && { assigned: options.assigned }),
        ...(options.onPlate === true && { onPlate: true }),
      },
    },
    since: null,
  });

  // The runner groups by card and keeps non-matching ancestors for context;
  // this command's contract is a flat list of matches, in the same path-then-
  // locator order the rows already carry.
  const todos = result.groups
    .flatMap((group) => group.rows)
    .flatMap((row) => row.items)
    .filter((item) => item.matching);

  if (options.json === true) {
    console.log(JSON.stringify({ todos, issues: result.issues }, null, 2));
    return;
  }

  printListing(todos);
  for (const line of formatIssues(result.issues)) console.log(line);
}

/** Section order for the default human listing — only non-empty groups print. */
const PLATE_GROUPS: { state: TodoPlateState; label: string }[] = [
  { state: "escalated", label: "ESCALATED" },
  { state: "on-plate", label: "ON PLATE" },
  { state: "quiet", label: "QUIET" },
  { state: "parked", label: "PARKED" },
  { state: "done", label: "DONE" },
  { state: "dropped", label: "DROPPED" },
];

function printListing(todos: DerivedTodo[]): void {
  if (todos.length === 0) {
    console.log("No todos match.");
    return;
  }
  for (const { state, label } of PLATE_GROUPS) {
    const group = todos.filter((todo) => todo.plateState === state);
    if (group.length === 0) continue;
    console.log(`${label} (${String(group.length)})`);
    for (const todo of group) {
      console.log(formatTodoRow(todo));
    }
  }
}
