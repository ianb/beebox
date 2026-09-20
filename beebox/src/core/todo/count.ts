/**
 * Box-wide count of the BOXHOLDER's todos that are on the plate NOW —
 * `escalated` (past due) plus `on-plate` (started, or undated). This is the
 * number behind the app nav's plate badge
 * (`docs/implemented-plans/todo-annotation.md` Track 4), which every page's
 * first request pays for.
 *
 * `assigned="agent"` todos are excluded: they are the agent's own follow-ups,
 * and a badge that counts them tells the boxholder they owe work they never
 * took on — which is also why an agent would otherwise avoid opening one at
 * all. They stay visible through `bbx todos --assigned agent`, a todo-view
 * card, and the review sweep's job brief. See `isBoxholderTodo`
 * (`src/shared/todo-model.ts`).
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
 *    stay visible through `bbx todos` / `todos.list`, which is where a
 *    boxholder looks for them.
 *
 * On a ~860-card box that is ~40 ms instead of ~200 ms.
 */

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { errorMessage } from "../../lib/error-guards.js";
import { mapInBatches } from "../../lib/map-batched.js";
import { isBoxholderTodo } from "../../shared/todo-model.js";
import { buildTodoScanContext } from "./collect.js";
import { listScopedCardPaths } from "../collection/card-scope.js";
import { extractCardTodos, mayHaveTodo } from "./extract.js";
import { deriveTodo } from "./derive.js";
import type { CollectedTodo } from "./collect-types.js";

/** Cards read at once. High enough to saturate the filesystem, low enough to bound open handles. */
const READ_CONCURRENCY = 64;

async function readCardText(absPath: string): Promise<string | null> {
  try {
    return await readFile(absPath, "utf8");
  } catch (e) {
    // Counting can't surface a per-card issue the way `bbx todos` does, so say
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
    listScopedCardPaths(boxRoot, "**/*.card"),
    buildTodoScanContext(boxRoot),
  ]);

  const todos: CollectedTodo[] = [];

  const read = await mapInBatches(absPaths, {
    size: READ_CONCURRENCY,
    map: async (absPath) => ({ absPath, content: await readCardText(absPath) }),
  });
  for (const { absPath, content } of read) {
    if (content === null) continue;
    if (!mayHaveTodo(content)) continue;
    // Extraction also reports issues; nothing reads them on this path (see the
    // module comment) — the badge is a number, not a report.
    const extracted = extractCardTodos({ relPath: path.relative(boxRoot, absPath), content, ctx });
    for (const item of extracted.items) todos.push(deriveTodo(item, plateCtx));
  }

  return todos.filter((t) => isBoxholderTodo(t) && (t.plateState === "escalated" || t.plateState === "on-plate")).length;
}
