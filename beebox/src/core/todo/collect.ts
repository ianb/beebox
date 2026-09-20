/**
 * The todo collector (`docs/implemented-plans/todo-annotation.md`, Track 3): glob every
 * card in a box, extract its todos (`extract.ts`, pure), derive plate-state
 * onto each (`derive.ts`), and return one deterministically ordered list.
 *
 * It is the transitional surface: the same signature it has always had, now
 * assembled from the two stages the collection runner uses
 * (`docs/plans/todo-collection.md`, Track 2), so `todos.list`, `bbx todos`,
 * the review sweep, and the ambient line keep working untouched.
 *
 * Read/query only — mutation is editing the card (normal card-edit path,
 * per the plan). `bbx todos` (`src/cli/commands/todos.ts`) is a thin
 * presentation layer over this.
 *
 * A card that fails to load (invalid frontmatter, unreadable file) or whose
 * body fails Markdoc parse/validate on a todo-relevant tag is reported as a
 * visible `TodoCollectionIssue`, never silently skipped — the plan's answer
 * to the "todo graveyard" failure mode every comparable inline system falls
 * into. Duplicate `id`s box-wide are likewise reported as issues; the
 * collection still returns every todo (duplication doesn't hide anything).
 */

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { type LoadCardContext } from "../card-io.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import { getBoxTime } from "../../lib/time.js";
import { loadBoxTimezone } from "../box/config.js";
import { type TodoPlateContext } from "../../shared/todo-model.js";
import { listScopedCardPaths } from "../collection/card-scope.js";
import { extractCardTodos, todoCardTypeIssue } from "./extract.js";
import { deriveTodo } from "./derive.js";
import { errorMessage } from "../../lib/error-guards.js";
import type {
  CollectedTodo,
  CollectTodosOptions,
  TodoCollectionIssue,
  TodoCollectionResult,
  TodoLocator,
} from "./collect-types.js";
import { formatTodoLocation } from "./collect-types.js";

/** The per-card load + plate-state context both scans need. */
export async function buildTodoScanContext(boxRoot: string): Promise<{ ctx: LoadCardContext; plateCtx: TodoPlateContext }> {
  const schemas = await createCardSchemaMap(boxRoot);
  return {
    ctx: { cardSchemas: schemas },
    plateCtx: {
      now: getBoxTime(boxRoot),
      timeZone: (await loadBoxTimezone(boxRoot)) ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  };
}

export async function collectTodos(boxRoot: string, options?: CollectTodosOptions): Promise<TodoCollectionResult> {
  const pattern = options?.glob ?? "**/*.card";
  const absPaths = await listScopedCardPaths(boxRoot, pattern);
  const { ctx, plateCtx } = await buildTodoScanContext(boxRoot);

  const todos: CollectedTodo[] = [];
  const issues: TodoCollectionIssue[] = [];

  for (const absPath of absPaths) {
    const relPath = path.relative(boxRoot, absPath);
    await collectOneCard({ absPath, relPath, ctx, plateCtx, todos, issues });
  }

  issues.push(...duplicateIdIssues(todos));
  todos.sort(compareByLocator);
  issues.sort((a, b) => (a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind.localeCompare(b.kind)));
  return { todos, issues };
}

async function collectOneCard(input: {
  absPath: string;
  relPath: string;
  ctx: LoadCardContext;
  plateCtx: TodoPlateContext;
  todos: CollectedTodo[];
  issues: TodoCollectionIssue[];
}): Promise<void> {
  const { absPath, relPath, ctx, plateCtx, todos, issues } = input;
  // Classify before reading, so a card that is *both* unknown-type and
  // unreadable reports the unknown type — the more actionable of the two.
  const typeIssue = todoCardTypeIssue({ relPath, ctx });
  if (typeIssue !== null) {
    issues.push(typeIssue);
    return;
  }
  let content: string;
  try {
    content = await readFile(absPath, "utf8");
  } catch (e) {
    issues.push({ kind: "load", path: relPath, message: errorMessage(e) });
    return;
  }
  const extracted = extractCardTodos({ relPath, content, ctx });
  for (const item of extracted.items) todos.push(deriveTodo(item, plateCtx));
  issues.push(...extracted.issues);
}

function duplicateIdIssues(todos: CollectedTodo[]): TodoCollectionIssue[] {
  const byId = new Map<string, string[]>();
  for (const todo of todos) {
    if (todo.id === undefined) continue;
    const locations = byId.get(todo.id) ?? [];
    locations.push(formatTodoLocation(todo));
    byId.set(todo.id, locations);
  }
  const issues: TodoCollectionIssue[] = [];
  for (const [id, locations] of byId) {
    if (locations.length < 2) continue;
    const sorted = locations.toSorted();
    issues.push({
      kind: "duplicate-id",
      path: sorted.join(", "),
      message: `duplicate todo id "${id}" used at: ${sorted.join(", ")}`,
    });
  }
  return issues.toSorted((a, b) => a.path.localeCompare(b.path));
}

function compareByLocator(a: CollectedTodo, b: CollectedTodo): number {
  if (a.path !== b.path) return a.path.localeCompare(b.path);
  return compareLocator(a.locator, b.locator);
}

/** Body locators sort before frontmatter locators on the same card — an arbitrary but deterministic tie-break (the plan doesn't order the two kinds against each other). */
function compareLocator(a: TodoLocator, b: TodoLocator): number {
  if (a.kind !== b.kind) return a.kind === "body" ? -1 : 1;
  if (a.kind === "body" && b.kind === "body") return a.line - b.line;
  if (a.kind === "frontmatter" && b.kind === "frontmatter") return a.index - b.index;
  return 0;
}
