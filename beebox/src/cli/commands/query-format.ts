/**
 * Turning a todo collection result into lines (`bbx query todos`, and the
 * shared parts of `bbx todos`).
 *
 * A terminal has no nesting to lean on, so the three things that make an
 * undated todo legible each get an explicit spelling: the card header names
 * the card, a `§` line names the section when it changes, and indentation
 * follows the parent chain. An ancestor the filter did not match is marked
 * `(context)` rather than silently reading as a match.
 *
 * Kept out of `query.ts` so the file stays under the line cap and so
 * `bbx todos` can reuse `formatIssues` unchanged.
 */

import { summaryText } from "../../core/file-summary.js";
import { formatTodoLocation } from "../../core/todo/collect-types.js";
import type { CollectionIssue } from "../../core/collection/types.js";
import type { DerivedTodo, TodoReduction } from "../../core/todo/collection.js";
import type { TodoQueryResult } from "../../core/todo/query.js";

type TodoRow = TodoQueryResult["groups"][number]["rows"][number];
type RowItem = TodoRow["items"][number];

/** `bbx todos`' row form, and the item half of `bbx query`'s: locator, id, text, dates. */
export function formatTodoRow(todo: DerivedTodo): string {
  const idPart = todo.id === undefined ? "" : `[${todo.id}] `;
  const meta: string[] = [];
  if (todo.assigned !== undefined) meta.push(`assigned=${todo.assigned}`);
  if (todo.due !== undefined) meta.push(`due=${todo.due}`);
  if (todo.start !== undefined) meta.push(`start=${todo.start}`);
  const metaStr = meta.length === 0 ? "" : `  (${meta.join(" ")})`;
  return `  ${formatTodoLocation(todo)}  ${idPart}${todo.text}${metaStr}`;
}

function reductionText(reduction: TodoReduction): string {
  const next = reduction.next === null ? "" : `, next ${reduction.next}`;
  return `${String(reduction.open)} open, ${String(reduction.done)} done${next}`;
}

export function formatTodoRows(rows: readonly TodoRow[]): string[] {
  const lines: string[] = [];
  for (const row of rows) {
    const refers = row.via === "reference" ? " (refers here)" : "";
    lines.push(`${summaryText(row.card)}  ${row.card.path}${refers}  — ${reductionText(row.reduction)}`);
    lines.push(...formatItems(row.items));
  }
  return lines;
}

function formatItems(items: readonly RowItem[]): string[] {
  const depths = depthsOf(items);
  const lines: string[] = [];
  let section: string | null = null;
  for (const item of items) {
    const path = item.sectionPath.join(" › ");
    if (path !== section) {
      section = path;
      if (path !== "") lines.push(` § ${path}`);
    }
    const indent = "  ".repeat(depths.get(formatTodoLocation(item)) ?? 0);
    const context = item.matching ? "" : "  (context)";
    lines.push(`${indent}${formatTodoRow(item)}${context}`);
    if (item.annotation !== "") lines.push(`${indent}      — ${item.annotation}`);
  }
  return lines;
}

/** How deep each item sits in the parent chain, walked over the items this row actually carries. */
function depthsOf(items: readonly RowItem[]): Map<string, number> {
  const present = new Set(items.map((item) => formatTodoLocation(item)));
  const depths = new Map<string, number>();
  for (const item of items) {
    let depth = 0;
    let parent = item.parent;
    while (parent !== null) {
      const key = formatTodoLocation({ path: item.path, locator: parent });
      if (!present.has(key)) break;
      depth++;
      parent = items.find((candidate) => formatTodoLocation(candidate) === key)?.parent ?? null;
    }
    depths.set(formatTodoLocation(item), depth);
  }
  return depths;
}

/** The trailing "could not be read" block, identical in `bbx query` and `bbx todos`. */
export function formatIssues(issues: readonly CollectionIssue[]): string[] {
  if (issues.length === 0) return [];
  return [
    "",
    `${String(issues.length)} cards could not be read for todos:`,
    ...issues.map((issue) => `  [${issue.kind}] ${issue.path}: ${issue.message}`),
  ];
}
