/**
 * Box-wide count of todos that are on the plate NOW — `escalated` (past due)
 * plus `on-plate` (started, or undated). This is the number behind the app
 * nav's plate badge (`docs/implemented-plans/todo-annotation.md` Track 4), which
 * every page's first request pays for.
 *
 * It is a fast path over the same machinery `collectTodos` uses — same card
 * set, same context, same per-card extraction (`collectCardTodos`) — with two
 * differences that only a *count* can make:
 *
 * 1. Card text is read with bounded parallelism rather than one card at a
 *    time. The full collector stays serial because its issue list is ordered
 *    work; a count doesn't care.
 * 2. A card whose text contains no `todo` substring at all can hold neither a
 *    `{% todo %}` body tag nor a `todos:` frontmatter entry, so it is skipped
 *    without parsing. The full collector still parses it, because it also
 *    reports cards that fail to load — a visibility guarantee the badge count
 *    has no way to surface anyway.
 *
 * On a ~860-card box that is ~40 ms instead of ~200 ms.
 */

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { errorMessage } from "../../lib/error-guards.js";
import { buildTodoScanContext, collectCardTodos, listTodoCardPaths } from "./collect.js";
import type { CollectedTodo, TodoCollectionIssue } from "./collect-types.js";

/** Cards read at once. High enough to saturate the filesystem, low enough to bound open handles. */
const READ_CONCURRENCY = 64;

/** Cheapest possible proof that a card cannot hold a todo in either capture form. */
function mayHaveTodo(content: string): boolean {
  return content.includes("todo");
}

async function readCardText(absPath: string): Promise<string | null> {
  try {
    return await readFile(absPath, "utf8");
  } catch (e) {
    // Counting can't surface a per-card issue the way `cb todos` does, so say
    // it here: a card we couldn't read is a card whose todos went uncounted.
    console.warn(`[todo-count] could not read ${absPath}, its todos are uncounted: ${errorMessage(e)}`);
    return null;
  }
}

/**
 * Number of open todos on the plate right now (`escalated` + `on-plate`)
 * across every card in the box.
 */
export async function countOnPlateTodos(boxRoot: string): Promise<number> {
  const [absPaths, { ctx, plateCtx }] = await Promise.all([
    listTodoCardPaths(boxRoot, "**/*.card"),
    buildTodoScanContext(boxRoot),
  ]);

  const todos: CollectedTodo[] = [];
  // Extraction wants an issue sink; nothing reads it on this path (see the
  // module comment) — the badge is a number, not a report.
  const issues: TodoCollectionIssue[] = [];

  for (let i = 0; i < absPaths.length; i += READ_CONCURRENCY) {
    const batch = absPaths.slice(i, i + READ_CONCURRENCY);
    const read = await Promise.all(
      batch.map(async (absPath) => ({ absPath, content: await readCardText(absPath) })),
    );
    for (const { absPath, content } of read) {
      if (content === null) continue;
      if (!mayHaveTodo(content)) continue;
      collectCardTodos({
        absPath,
        relPath: path.relative(boxRoot, absPath),
        content,
        ctx,
        plateCtx,
        todos,
        issues,
      });
    }
  }

  return todos.filter((t) => t.plateState === "escalated" || t.plateState === "on-plate").length;
}
