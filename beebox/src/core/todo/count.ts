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
 * It is a fast path over the same machinery the collection runner uses — same
 * card set, same context, same per-card `extractCardTodos` and `deriveTodo` —
 * deliberately NOT going through `runCollection`, with two differences that
 * only a *count* can make:
 *
 * 1. Card text is read with bounded parallelism rather than one card at a
 *    time. The runner stays serial because its issue list is ordered work;
 *    a count doesn't care.
 * 2. A card whose text can't possibly name a todo is skipped without parsing.
 *    The runner still parses it, because it also reports cards that
 *    fail to load — issues the badge count has no way to surface anyway; they
 *    stay visible through `bbx query todos` / `collections.query`, where a
 *    boxholder looks for them.
 *
 * On a ~860-card box that is ~40 ms instead of ~200 ms.
 */

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { errorMessage } from "../../lib/error-guards.js";
import { mapInBatches } from "../../lib/map-batched.js";
import { isBoxholderTodo } from "../../shared/todo-model.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import { getBoxTime } from "../../lib/time.js";
import { loadBoxTimezone } from "../box/config.js";
import { listScopedCardPaths } from "../collection/card-scope.js";
import { extractCardTodos, mayHaveTodo } from "./extract.js";
import { deriveTodo } from "./derive.js";
import type { CollectedTodo } from "./collect-types.js";
import type { LoadCardContext } from "../card-io.js";
import type { TodoPlateContext } from "../../shared/todo-model.js";

/** The per-card load context and the box's clock, the two things extraction and derivation need. */
async function buildTodoScanContext(boxRoot: string): Promise<{ ctx: LoadCardContext; plateCtx: TodoPlateContext }> {
  return {
    ctx: { cardSchemas: await createCardSchemaMap(boxRoot) },
    plateCtx: {
      now: getBoxTime(boxRoot),
      timeZone: (await loadBoxTimezone(boxRoot)) ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  };
}

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

/** Every boxholder todo the box holds, whatever its status — the shared gather both counts below read. */
async function gatherBoxholderTodos(boxRoot: string): Promise<CollectedTodo[]> {
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

  return todos.filter(isBoxholderTodo);
}

/** The two counts the nav badge needs: on-plate now, and how many of those are past due. */
export interface PlateTodoCounts {
  onPlate: number;
  escalated: number;
}

/**
 * Both plate counts in one pass over {@link gatherBoxholderTodos} — the same
 * predicate `countOnPlateTodos` used to apply inline, so the dot the nav
 * shows next to the badge can never disagree with the number inside it.
 */
export async function countPlateTodos(boxRoot: string): Promise<PlateTodoCounts> {
  const todos = await gatherBoxholderTodos(boxRoot);
  let onPlate = 0;
  let escalated = 0;
  for (const t of todos) {
    if (t.plateState === "escalated") {
      onPlate++;
      escalated++;
    } else if (t.plateState === "on-plate") {
      onPlate++;
    }
  }
  return { onPlate, escalated };
}

/**
 * Number of open todos on the plate right now (`escalated` + `on-plate`)
 * across every card in the box.
 */
export async function countOnPlateTodos(boxRoot: string): Promise<number> {
  return (await countPlateTodos(boxRoot)).onPlate;
}
