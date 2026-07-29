/**
 * Shared record shapes for the todo collector (`collect.ts`) and its two
 * capture-form walkers (`collect-body.ts` for `{% todo %}`, `collect.ts`
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

/** Where a todo lives within its card: a body `{% todo %}` tag (line, 1-indexed, in the FILE, not the body) or an entry in the frontmatter `todos:` list (index). */
export type TodoLocator = { kind: "body"; line: number } | { kind: "frontmatter"; index: number };

/** A `{% see-also %}` reference, from either capture form. */
export interface TodoSeeAlso {
  ref: string | undefined;
  href: string | undefined;
  note: string | undefined;
}

/** One collected todo, from either capture form, with its derived plate-state. */
export interface CollectedTodo {
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
 *   already surfaces via `cb validate`/card-lint).
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

/** `path:line` for a body todo, `path#todos[i]` for a frontmatter one — the CLI's locator display form (`cb todos`, duplicate-id messages). */
export function formatTodoLocation(todo: Pick<CollectedTodo, "path" | "locator">): string {
  const { path, locator } = todo;
  return locator.kind === "body" ? `${path}:${String(locator.line)}` : `${path}#todos[${String(locator.index)}]`;
}

/**
 * Build a `TodoPlateInput` from possibly-`undefined` `start`/`due` values —
 * `TodoPlateInput`'s fields are optional (`?:`), not `X | undefined`, so
 * under `exactOptionalPropertyTypes` an `undefined` value can't be assigned
 * to the key directly; it must be omitted instead. Shared by both capture
 * forms (`collect-body.ts`'s tag walk, `collect.ts`'s frontmatter-entry
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
