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
 * 2. A card whose text can't possibly name a todo is skipped without parsing.
 *    The full collector still parses it, because it also reports cards that
 *    fail to load — issues the badge count has no way to surface anyway; they
 *    stay visible through `cb todos` / `todos.list`, which is where a
 *    boxholder looks for them.
 *
 * On a ~860-card box that is ~40 ms instead of ~200 ms.
 */

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { errorMessage } from "../../lib/error-guards.js";
import { mapInBatches } from "../../lib/map-batched.js";
import { buildTodoScanContext, collectCardTodos, listTodoCardPaths } from "./collect.js";
import type { CollectedTodo, TodoCollectionIssue } from "./collect-types.js";

/** Cards read at once. High enough to saturate the filesystem, low enough to bound open handles. */
const READ_CONCURRENCY = 64;

/**
 * Cheapest possible proof that a card cannot hold a todo in either capture
 * form. Both forms have to spell "todo" in the file: the body tag is matched
 * on `node.tag === "todo"` (`collect-body.ts`), and the frontmatter list is
 * the `todos:` key. The one way YAML can name that key without the literal
 * characters is an escape inside a double-quoted key (`"todos":`), so a
 * backslash anywhere in the card also buys a full parse — pathological, but
 * cheap to be right about, and a backslash is rare enough that the fast path
 * survives.
 */
function mayHaveTodo(content: string): boolean {
  return content.includes("todo") || content.includes("\\");
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

  const read = await mapInBatches(absPaths, {
    size: READ_CONCURRENCY,
    map: async (absPath) => ({ absPath, content: await readCardText(absPath) }),
  });
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

  return todos.filter((t) => t.plateState === "escalated" || t.plateState === "on-plate").length;
}
