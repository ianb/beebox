/**
 * Shared record shapes for the todo collector (`collect.ts`) and its two
 * capture-form extractors (`extract-body.ts` for `{% todo %}`, `extract.ts`
 * itself for the frontmatter `todos:` list).
 *
 * Optional attribute fields are typed `X | undefined` rather than `X?:` —
 * same convention as `TodoAttributes` in `shared/todo-model.ts` — so a
 * caller built from an already-`string | undefined` source (Markdoc's
 * `stringAttr` narrowing, or a Zod-optional field) can pass values straight
 * through under `exactOptionalPropertyTypes`, and `JSON.stringify` drops the
 * `undefined` keys automatically for `--json` output.
 */

import type { TodoPlateInput, TodoPlateState, TodoStatus } from "../../shared/todo-model.js";
import type { TodoLocator } from "../../shared/todo-locators.js";

/**
 * Where a todo lives within its card. Defined in `shared/todo-locators.ts`
 * (with the pass that assigns it, `assignLocators`) because the frontend
 * render path needs the same type; re-exported here so every existing
 * `collect-types.js` import keeps working.
 */
export type { TodoLocator };

/** A `{% see-also %}` reference, from either capture form. */
export interface TodoSeeAlso {
  ref: string | undefined;
  href: string | undefined;
  note: string | undefined;
}

/**
 * One todo exactly as its card spells it — the output of the PURE extract
 * stage (`extract.ts`). Nothing here depends on a clock, a timezone, or any
 * other card, which is what lets a cache sit in front of extraction later
 * (`docs/plans/todo-collection.md`, Track 2).
 *
 * The three position/reference fields are what make an undated todo legible:
 * where it was written (`sectionPath`, `parent`), what the author said right
 * after it (`annotation`), and what it points at (`refs`).
 */
export interface TodoItem {
  /** Box-relative card path. */
  path: string;
  locator: TodoLocator;
  id: string | undefined;
  text: string;
  status: TodoStatus;
  assigned: string | undefined;
  by: string | undefined;
  created: string | undefined;
  due: string | undefined;
  start: string | undefined;
  seeAlso: TodoSeeAlso[];
  /** Heading texts above the todo, outermost first. `[]` for a frontmatter todo, or a body todo written above the first heading. */
  sectionPath: string[];
  /** The todo whose list item (or block-form `{% todo %}`) contains this one, or `null` at the top level. */
  parent: TodoLocator | null;
  /** Text written after the closing tag inside the same paragraph, with its leading separator trimmed. `""` when there is none. */
  annotation: string;
  /** Box-relative paths this todo points at — resolved, deduped, in order of appearance, NOT checked for existence. */
  refs: string[];
}

/**
 * One collected todo with the box-local plate-state derived onto it — the
 * output of the derive stage (`derive.ts`). The clock lives here and nowhere
 * upstream.
 */
export interface CollectedTodo extends TodoItem {
  plateState: TodoPlateState;
}

/**
 * A card that could not fully contribute its todos, reported alongside the
 * successfully collected ones — never a silent skip (the plan's Track 3
 * "visible-invalid results" rule). One shape covers all four causes:
 * - `load` — the card failed to load (invalid frontmatter, unreadable file).
 * - `parse` — the body failed to parse as Markdoc.
 * - `validate` — the body parsed, but `Markdoc.validate` reported an error
 *   attributed to a `{% todo %}`/`{% see-also %}` tag (an unrelated body
 *   validation error elsewhere is out of the todo collector's remit — it
 *   already surfaces via `bbx validate`/card-lint).
 * - `unknown-type` — the file matched the glob and is named like a card
 *   (`Name.<type>.card`) but `<type>` has no registered schema, so it can't
 *   be loaded/scanned at all. Reported rather than silently skipped — a
 *   card whose schema went missing (a deleted box-local schema, a typo'd
 *   filename) could otherwise hide its todos forever with no signal.
 * - `duplicate-id` — the same `id` was used by more than one todo box-wide.
 */
export interface TodoCollectionIssue {
  kind: "load" | "parse" | "validate" | "unknown-type" | "duplicate-id";
  /** Card path for load/parse/validate; comma-joined locations for duplicate-id. */
  path: string;
  message: string;
}

export interface TodoCollectionResult {
  /** Deterministically ordered: path, then locator (body line / frontmatter index). */
  todos: CollectedTodo[];
  /** Deterministically ordered: kind, then path. */
  issues: TodoCollectionIssue[];
}

export interface CollectTodosOptions {
  /** Glob pattern (relative to box root) scoping which cards are scanned. Default: every card. */
  glob?: string;
}

/**
 * `path:line` for a body todo (`path:line#2` for the second and later todo on
 * that line), `path#todos[i]` for a frontmatter one — the CLI's locator
 * display form (`bbx todos`, duplicate-id messages, the review sweep's job
 * items) and the identity a collection keys items by.
 */
export function formatTodoLocation(todo: Pick<CollectedTodo, "path" | "locator">): string {
  const { path, locator } = todo;
  if (locator.kind === "frontmatter") return `${path}#todos[${String(locator.index)}]`;
  const nth = locator.nth === undefined || locator.nth <= 1 ? "" : `#${String(locator.nth)}`;
  return `${path}:${String(locator.line)}${nth}`;
}

/** Body locators sort before frontmatter locators on the same card — an arbitrary but deterministic tie-break (the plan doesn't order the two kinds against each other). */
export function compareTodoLocator(a: TodoLocator, b: TodoLocator): number {
  if (a.kind !== b.kind) return a.kind === "body" ? -1 : 1;
  if (a.kind === "body" && b.kind === "body") {
    if (a.line !== b.line) return a.line - b.line;
    return (a.nth ?? 1) - (b.nth ?? 1);
  }
  if (a.kind === "frontmatter" && b.kind === "frontmatter") return a.index - b.index;
  return 0;
}

/**
 * Build a `TodoPlateInput` from possibly-`undefined` `start`/`due` values —
 * `TodoPlateInput`'s fields are optional (`?:`), not `X | undefined`, so
 * under `exactOptionalPropertyTypes` an `undefined` value can't be assigned
 * to the key directly; it must be omitted instead. Shared by both capture
 * forms (`extract-body.ts`'s tag walk, `extract.ts`'s frontmatter-entry
 * walk) so the omission dance isn't repeated.
 */
export function plateInputFor(input: {
  status: TodoStatus;
  start: string | undefined;
  due: string | undefined;
}): TodoPlateInput {
  const { status, start, due } = input;
  return {
    status,
    ...(start !== undefined && { start }),
    ...(due !== undefined && { due }),
  };
}
