/**
 * `cb todos` — read/query-only surface over the todo collector
 * (`core/todo/collect.ts`, `docs/implemented-plans/todo-annotation.md` Track 3).
 *
 * Designed for agent consumption (the plan's boxholder call): deterministic,
 * locator-carrying rows; a human-compact-but-parseable default listing
 * grouped by plate-state; `--json` for the full structured records.
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
import { collectTodos } from "../../core/todo/collect.js";
import { formatTodoLocation, type CollectedTodo, type TodoCollectionResult } from "../../core/todo/collect-types.js";
import { isTodoStatus, type TodoPlateState, type TodoStatus } from "../../shared/todo-model.js";
import { errorMessage } from "../../lib/error-guards.js";

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
  const result = await collectTodos(boxRoot, options.glob === undefined ? undefined : { glob: options.glob });
  const filtered = result.todos.filter((todo) => matchesFilters(todo, { status, assigned: options.assigned, onPlate: options.onPlate === true }));

  if (options.json === true) {
    const payload: TodoCollectionResult = { todos: filtered, issues: result.issues };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  printListing(filtered);
  printIssues(result.issues);
}

function matchesFilters(
  todo: CollectedTodo,
  filters: { status: TodoStatus; assigned: string | undefined; onPlate: boolean }
): boolean {
  if (todo.status !== filters.status) return false;
  if (filters.assigned !== undefined && todo.assigned !== filters.assigned) return false;
  if (filters.onPlate && todo.plateState !== "escalated" && todo.plateState !== "on-plate") return false;
  return true;
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

function printListing(todos: CollectedTodo[]): void {
  if (todos.length === 0) {
    console.log("No todos match.");
    return;
  }
  for (const { state, label } of PLATE_GROUPS) {
    const group = todos.filter((todo) => todo.plateState === state);
    if (group.length === 0) continue;
    console.log(`${label} (${String(group.length)})`);
    for (const todo of group) {
      console.log(formatRow(todo));
    }
  }
}

function formatRow(todo: CollectedTodo): string {
  const loc = formatTodoLocation(todo);
  const idPart = todo.id === undefined ? "" : `[${todo.id}] `;
  const meta: string[] = [];
  if (todo.assigned !== undefined) meta.push(`assigned=${todo.assigned}`);
  if (todo.due !== undefined) meta.push(`due=${todo.due}`);
  if (todo.start !== undefined) meta.push(`start=${todo.start}`);
  const metaStr = meta.length === 0 ? "" : `  (${meta.join(" ")})`;
  return `  ${loc}  ${idPart}${todo.text}${metaStr}`;
}

function printIssues(issues: TodoCollectionResult["issues"]): void {
  if (issues.length === 0) return;
  console.log("");
  console.log(`${String(issues.length)} cards could not be read for todos:`);
  for (const issue of issues) {
    console.log(`  [${issue.kind}] ${issue.path}: ${issue.message}`);
  }
}
