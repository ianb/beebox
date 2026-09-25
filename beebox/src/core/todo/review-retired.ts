/**
 * The recheck history's view of `recheck="never"` (`docs/plans/todos-ui.md`,
 * Track 7), used by `check` (`review-check.ts`).
 *
 * `never` means two different things. Written by the review's own `verify`
 * (a retired todo), it holds only while the todo is as it was retired: any
 * edit — its words, or anything in its snapshot (`review-snapshot.ts`) — puts
 * it back in review, and the agent then replaces `never` with a date. Written
 * by anyone else (no retired record for it), it is the boxholder's say-so and
 * is respected — unless `verify` already refused it as the review agent's.
 *
 * A retired todo is found in the history by card path + words; a reworded one
 * by the place it was retired (same card, same locator) when its old words
 * are gone from the card.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../../lib/error-guards.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import { RECHECK_NEVER } from "../../shared/todo-model.js";
import { extractCardTodos } from "./extract.js";
import { formatTodoLocation, type TodoItem } from "./collect-types.js";
import { recheckKey, recheckKeyParts, type RecheckRecord } from "./review-state.js";
import { changedSince } from "./review-snapshot.js";

/** Every todo on each card the history names; `null` for a card that is gone. */
export type HistoryCards = Map<string, TodoItem[] | null>;

async function cardTodos(
  boxRoot: string,
  input: { relPath: string; cardSchemas: Awaited<ReturnType<typeof createCardSchemaMap>> },
): Promise<TodoItem[] | null> {
  let content: string;
  try {
    content = await fs.readFile(path.join(boxRoot, input.relPath), "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
  return extractCardTodos({ relPath: input.relPath, content, ctx: { cardSchemas: input.cardSchemas } }).items;
}

export async function loadHistoryCards(boxRoot: string, rechecks: Record<string, RecheckRecord>): Promise<HistoryCards> {
  const cardSchemas = await createCardSchemaMap(boxRoot);
  const cards: HistoryCards = new Map();
  for (const key of Object.keys(rechecks)) {
    const parts = recheckKeyParts(key);
    if (parts === null || cards.has(parts.path)) continue;
    cards.set(parts.path, await cardTodos(boxRoot, { relPath: parts.path, cardSchemas }));
  }
  return cards;
}

/** The key of the retired record that describes `todo`, or `null` when none does. */
function retiredKeyFor(input: { rechecks: Record<string, RecheckRecord>; cards: HistoryCards; todo: TodoItem }): string | null {
  const { rechecks, cards, todo } = input;
  const exact = recheckKey(todo);
  if (rechecks[exact]?.retired !== undefined) return exact;
  const texts = new Set((cards.get(todo.path) ?? []).map((t) => t.text));
  const where = formatTodoLocation(todo);
  for (const [key, record] of Object.entries(rechecks)) {
    const parts = recheckKeyParts(key);
    if (parts === null || parts.path !== todo.path || record.retired === undefined || texts.has(parts.text)) continue;
    if (formatTodoLocation({ path: parts.path, locator: record.retired.locator }) === where) return key;
  }
  return null;
}

/** Whether a `never` todo stays out of review: hand-set, or retired and unchanged since. */
export function neverDefers(input: { rechecks: Record<string, RecheckRecord>; cards: HistoryCards; todo: TodoItem }): boolean {
  if (input.rechecks[recheckKey(input.todo)]?.neverRejected === true) return false; // the agent wrote it, and verify refused it
  const key = retiredKeyFor(input);
  if (key === null) return true;
  const retired = input.rechecks[key]?.retired;
  if (retired === undefined || key !== recheckKey(input.todo)) return false; // reworded
  return changedSince(retired.snapshot, input.todo).length === 0;
}

/** The history without the retired record for `todo`, which is re-entering review. */
export function clearRetired(input: { rechecks: Record<string, RecheckRecord>; cards: HistoryCards; todo: TodoItem }): Record<string, RecheckRecord> {
  const key = retiredKeyFor(input);
  if (key === null) return input.rechecks;
  const rest = { ...input.rechecks };
  delete rest[key];
  return rest;
}

/**
 * The history without entries for cards that are gone or todos whose words
 * no longer appear on their card — except a retired record whose place still
 * holds a `never` todo (a reworded retired todo not yet back in review).
 */
export function pruneRechecks(input: { rechecks: Record<string, RecheckRecord>; cards: HistoryCards }): Record<string, RecheckRecord> {
  const kept: Record<string, RecheckRecord> = {};
  for (const [key, record] of Object.entries(input.rechecks)) {
    const parts = recheckKeyParts(key);
    const todos = parts === null ? null : (input.cards.get(parts.path) ?? null);
    if (parts === null || todos === null) continue;
    const retired = record.retired;
    const holds =
      todos.some((t) => t.text === parts.text) ||
      (retired !== undefined &&
        todos.some((t) => t.recheck === RECHECK_NEVER && formatTodoLocation(t) === formatTodoLocation({ path: parts.path, locator: retired.locator })));
    if (holds) kept[key] = record;
  }
  return kept;
}
