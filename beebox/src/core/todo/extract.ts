/**
 * One card in, its todos out — the PURE stage of the todo collection
 * (`docs/plans/todo-collection.md`, Track 2).
 *
 * `extractCardTodos` reads no clock, no timezone, and no other card. Its
 * whole input is the card's own text plus the box's schema map, which is
 * what lets a cache sit in front of it later, and what makes plate-state a
 * separate `deriveTodo` step rather than something baked into extraction.
 * The rule is held by the types, not by a test: there is nowhere in
 * `extractCardTodos`' input to put a `now`.
 *
 * Both capture forms land here — `{% todo %}` tags (via `extract-body.ts`)
 * and frontmatter `todos:` entries, already Zod-validated at load. A card
 * that fails to load, or whose body fails Markdoc parse/validate on a
 * todo-relevant tag, contributes a visible `TodoCollectionIssue` rather than
 * a silent skip.
 */

import { splitCardContent } from "../../cards/index.js";
import { parseCardText, typeFromFilename, type LoadCardContext } from "../card-io.js";
import { TodosFieldSchema } from "../../shared/todo-model.js";
import { errorMessage } from "../../lib/error-guards.js";
import { extractBodyTodos } from "./extract-body.js";
import { resolveTodoRefs } from "../../shared/todo-text.js";
import type { TodoCollectionIssue, TodoItem } from "./collect-types.js";

export interface CardTodoExtraction {
  items: TodoItem[];
  issues: TodoCollectionIssue[];
}

/**
 * Cheapest possible proof that a card cannot hold a todo in either capture
 * form. Both forms have to spell "todo" in the file: the body tag is matched
 * on `node.tag === "todo"` (`extract-body.ts`), and the frontmatter list is
 * the `todos:` key. The one way YAML can name that key without the literal
 * characters is an escape inside a double-quoted key (`"todos":`), so a
 * backslash anywhere in the card also buys a full parse — pathological, but
 * cheap to be right about, and a backslash is rare enough that the fast path
 * survives.
 *
 * Used by the nav-badge count (`count.ts`) and by the collection runner's
 * reference pass, which would otherwise parse every card in the box.
 */
export function mayHaveTodo(content: string): boolean {
  return content.includes("todo") || content.includes("\\");
}

/**
 * The card's type, or the issue for a card whose type can't be schema-loaded
 * at all (an unparseable filename, or a `type` with no registered schema — a
 * deleted box-local schema, a typo'd filename). Such a card is reported as
 * visible-invalid rather than silently skipped: "any globbed card that cannot
 * be schema-loaded is reported" is what the todo-annotation plan's
 * visible-invalid guarantee means — a schema that goes missing shouldn't be
 * able to hide a card's todos forever with zero signal.
 */
function classifyCardType(input: {
  relPath: string;
  ctx: LoadCardContext;
}): { ok: true; type: string } | { ok: false; issue: TodoCollectionIssue } {
  const { relPath, ctx } = input;
  const type = typeFromFilename(relPath);
  if (type !== undefined && ctx.cardSchemas.has(type)) return { ok: true, type };
  return {
    ok: false,
    issue: {
      kind: "unknown-type",
      path: relPath,
      message:
        type === undefined
          ? "card filename doesn't match the Name.<type>.card pattern"
          : `no registered schema for card type "${type}"`,
    },
  };
}

/** Every todo one already-read card spells, with anything that blocked extraction reported beside them. */
export function extractCardTodos(input: {
  relPath: string;
  content: string;
  ctx: LoadCardContext;
}): CardTodoExtraction {
  const { relPath, content, ctx } = input;
  const classified = classifyCardType({ relPath, ctx });
  if (!classified.ok) return { items: [], issues: [classified.issue] };

  let parsed: ReturnType<typeof parseCardText>;
  try {
    parsed = parseCardText(content, { source: relPath, schemas: ctx.cardSchemas, type: classified.type });
  } catch (e) {
    return { items: [], issues: [{ kind: "load", path: relPath, message: errorMessage(e) }] };
  }

  const items: TodoItem[] = [];
  const issues: TodoCollectionIssue[] = [];

  // Body todos come first, matching the collector's tie-break between the two
  // capture forms, so a caller that does not re-sort still sees canonical order.
  const lineOffset = splitCardContent(content).lineOffset;
  const body = extractBodyTodos({ relPath, bodyText: parsed.rawBody, lineOffset });
  if (body.ok) {
    items.push(...body.items);
  } else {
    issues.push({ kind: body.kind, path: relPath, message: body.message });
  }
  items.push(...frontmatterTodos({ relPath, fields: parsed.fields }));
  return { items, issues };
}

/**
 * Frontmatter `todos:` entries. They have no position in the body, so they
 * carry no `sectionPath`, no `parent`, and no `annotation` — their `see-also`
 * entries are the only place a reference can come from.
 */
function frontmatterTodos(input: { relPath: string; fields: Record<string, unknown> }): TodoItem[] {
  const { relPath, fields } = input;
  const parsed = TodosFieldSchema.safeParse(fields["todos"]);
  const entries = parsed.success && parsed.data !== undefined ? parsed.data : [];
  return entries.map((entry, index): TodoItem => {
    const seeAlso = (entry["see-also"] ?? []).map((sa) => ({ ref: sa.ref, href: sa.href, note: sa.note }));
    const refCandidates: string[] = [];
    for (const sa of seeAlso) {
      if (sa.ref !== undefined) refCandidates.push(sa.ref);
    }
    return {
      path: relPath,
      locator: { kind: "frontmatter", index },
      id: entry.id,
      text: entry.text,
      status: entry.status ?? "open",
      assigned: entry.assigned,
      by: entry.by,
      created: entry.created,
      due: entry.due,
      start: entry.start,
      seeAlso,
      sectionPath: [],
      parent: null,
      annotation: "",
      refs: resolveTodoRefs(relPath, refCandidates),
    };
  });
}
