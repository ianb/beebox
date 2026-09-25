/**
 * Raw-AST walk for `{% todo %}` tags inside one card's markdown body, keeping
 * each todo's POSITION (heading path, enclosing list item) and its REFERENCES
 * (`{% see-also %}` refs, markdown links) — `docs/plans/todo-collection.md`
 * Track 2.
 *
 * Parses the body once, runs `Markdoc.validate` once, then walks the RAW
 * (pre-transform) AST for `node.tag === "todo"` — the authored lowercase
 * name; `TodoInline`/`TodoBlock` exist only post-transform, where source
 * lines are gone (`body-refs.ts` is the precedent for walking the raw tree).
 *
 * The walk is recursive over `children` with its own stack, because a raw
 * Markdoc node has no parent pointer, and because the three things this
 * module keeps are all *context*: the heading levels seen so far, the
 * enclosing list item's own todo, and a todo tag's following siblings.
 * `ast.walk()` (a flat iterator) can express none of them.
 *
 * A parse failure, or a validate error attributed to a `{% todo %}`/
 * `{% see-also %}` tag (via `body-markdoc-lint.ts`'s tag-span attribution —
 * an unrelated validate error elsewhere in the body is not this module's
 * concern), makes the WHOLE card's body contribute one visible-invalid
 * result instead of a partial todo list: the plan calls for a card-level
 * signal ("that card contributes a visible-invalid entry"), not a
 * best-effort partial collection that could quietly hide a sibling todo's
 * own errors.
 *
 * Todo identity (`TodoLocator`) and the pass that assigns it
 * (`assignLocators`) live in `shared/todo-locators.ts`, not here — the
 * frontend render path needs the same numbering, so one function serves
 * both (`docs/plans/todos-ui.md`, Track 2).
 */

import Markdoc from "@markdoc/markdoc";
import type { Node } from "@markdoc/markdoc";
import { markdocConfig } from "../../shared/markdoc-config.js";
import { collectTagSpans, tagNameFor } from "../body-markdoc-lint.js";
import { isTodoStatus } from "../../shared/todo-model.js";
import { assignLocators, isTodoTag } from "../../shared/todo-locators.js";
import type { TodoItem, TodoLocator } from "./collect-types.js";
import { errorMessage } from "../../lib/error-guards.js";
import { invariant } from "../../lib/invariant.js";
import { flattenNodes, resolveTodoRefs, type FlattenResult } from "../../shared/todo-text.js";

// Markdoc ships dual CJS/ESM but its `exports` field is null, so Node ESM
// imports resolve to the CJS bundle — which only exposes a default export.
// Same pattern as `body-refs.ts` / `body-markdoc-lint.ts`.
// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
const { parse, validate } = Markdoc;

export type BodyExtractResult =
  | { ok: true; items: TodoItem[] }
  | { ok: false; kind: "parse" | "validate"; message: string };

/** Mutable walk context: everything that depends on where in the tree we are. */
interface WalkState {
  /** Box-relative card path — the item's `path`, and the base every ref resolves against. */
  relPath: string;
  /** The frontmatter block's line count, added to a body-relative line to report the true file line. */
  lineOffset: number;
  /** The heading text last seen at each level (index = Markdoc's `attributes.level`). A deeper level is cleared when a shallower heading arrives. */
  headings: (string | undefined)[];
  /** Every todo tag's identity, assigned up front (see `assignLocators`). */
  locators: Map<Node, TodoLocator>;
  items: TodoItem[];
}

/** Extract every `{% todo %}` in one card's body, with position and references. */
export function extractBodyTodos(input: {
  relPath: string;
  bodyText: string;
  lineOffset: number;
}): BodyExtractResult {
  const { relPath, bodyText, lineOffset } = input;
  if (bodyText === "") return { ok: true, items: [] };

  let ast: Node;
  try {
    ast = parse(bodyText);
  } catch (e) {
    return { ok: false, kind: "parse", message: `body failed to parse as Markdoc: ${errorMessage(e)}` };
  }

  const tagSpans = collectTagSpans(ast);
  const errors = validate(ast, markdocConfig).filter(
    (entry) => entry.error.level === "error" || entry.error.level === "critical"
  );
  const todoErrors = errors.filter((entry) => {
    const tag = tagNameFor(tagSpans, entry.lines);
    return tag === "todo" || tag === "see-also";
  });
  if (todoErrors.length > 0) {
    const message = todoErrors.map((entry) => `line ${lineFor(entry.lines)}: ${entry.error.message}`).join("; ");
    return { ok: false, kind: "validate", message };
  }

  const state: WalkState = {
    relPath,
    lineOffset,
    headings: [],
    locators: assignLocators(ast, lineOffset),
    items: [],
  };
  walkChildren(ast, { state, parent: null });
  return { ok: true, items: state.items };
}

/** Where the walk is: the mutable card-wide state, and the todo that owns whatever we are inside. */
interface WalkCursor {
  state: WalkState;
  parent: TodoLocator | null;
}

function walkChildren(container: Node, cursor: WalkCursor): void {
  for (const [index, child] of container.children.entries()) {
    visit({ node: child, container, index, ...cursor });
  }
}

function visit(input: {
  node: Node;
  container: Node;
  index: number;
  state: WalkState;
  parent: TodoLocator | null;
}): void {
  const { node, container, index, state, parent } = input;

  if (node.type === "heading") {
    const level = headingLevel(node);
    // A heading defines a section, so a todo written inside one belongs to the
    // sections ABOVE it rather than naming itself. The deeper levels are
    // cleared before the walk, and this heading's own text is recorded after
    // it — the todo sees the path it sits under, not the path it starts.
    if (level !== null) state.headings.length = level;
    walkChildren(node, { state, parent: null });
    if (level !== null) recordHeading(node, { state, level });
    return;
  }

  if (isTodoTag(node)) {
    // Annotation is a same-paragraph notion: only an INLINE container has
    // "the rest of the sentence" after the closing tag. A block-form todo,
    // whose siblings are block nodes, gets "".
    const following = container.type === "inline" ? container.children.slice(index + 1) : [];
    const item = buildItem({ node, state, parent, following });
    state.items.push(item);
    // Todos written INSIDE a block-form todo take it as their parent.
    walkChildren(node, { state, parent: item.locator });
    return;
  }

  if (node.type === "item") {
    walkItem(node, { state, parent });
    return;
  }

  walkChildren(node, { state, parent });
}

/**
 * A list item's own todo *owns* it: anything nested under the item hangs off
 * that todo. The owner is a todo sitting in one of the item's direct `inline`
 * or `paragraph` children — in a loose list the item's first paragraph is
 * often plain prose and the todo is in a later one — and when several
 * qualify, the LAST one written before the nested list. An item with no todo
 * of its own is skipped: its children inherit the enclosing todo instead, so
 * a plain "Kitchen" bullet does not break the chain.
 */
function walkItem(item: Node, { state, parent }: WalkCursor): void {
  const ownerLocator = findOwnerLocator(item, state);
  for (const [index, child] of item.children.entries()) {
    const inOwnText = child.type === "inline" || child.type === "paragraph";
    visit({
      node: child,
      container: item,
      index,
      state,
      // The item's own text belongs to the enclosing todo; everything nested
      // below it belongs to this item's todo, when it has one.
      parent: inOwnText ? parent : (ownerLocator ?? parent),
    });
  }
}

function findOwnerLocator(item: Node, state: WalkState): TodoLocator | null {
  let owner: Node | null = null;
  for (const child of item.children) {
    if (child.type === "list") break; // "the last one BEFORE the nested list"
    if (child.type !== "inline" && child.type !== "paragraph") continue;
    for (const candidate of todoTagsIn(child)) owner = candidate;
  }
  return owner === null ? null : locatorFor(owner, state);
}

/** Todo tags within one inline/paragraph subtree, in document order, not descending into a todo's own body. */
function todoTagsIn(node: Node): Node[] {
  const found: Node[] = [];
  for (const child of node.children) {
    if (isTodoTag(child)) {
      found.push(child);
      continue;
    }
    found.push(...todoTagsIn(child));
  }
  return found;
}

function buildItem(input: {
  node: Node;
  state: WalkState;
  parent: TodoLocator | null;
  following: Node[];
}): TodoItem {
  const { node, state, parent, following } = input;
  const attrs = node.attributes;
  const statusRaw = stringAttr(attrs["status"]);
  // `extractBodyTodos` already returned `ok: false` above for any `todo`-
  // attributed validate error, which includes an out-of-enum `status` (the
  // tag schema declares `matches: [...TODO_STATUSES]`) — so by the time we
  // get here `statusRaw` is either absent or already a valid `TodoStatus`.
  // The `isTodoStatus` check is not a silent-coercion fallback for a bad
  // value slipping through; it's TypeScript narrowing for the absent case.
  const status = statusRaw !== undefined && isTodoStatus(statusRaw) ? statusRaw : "open";
  const body = flattenNodes(node.children);
  const annotation = flattenNodes(stopAtNextTodo(following));
  return {
    path: state.relPath,
    locator: locatorFor(node, state),
    id: stringAttr(attrs["id"]),
    text: body.text,
    status,
    assigned: stringAttr(attrs["assigned"]),
    by: stringAttr(attrs["by"]),
    created: stringAttr(attrs["created"]),
    due: stringAttr(attrs["due"]),
    start: stringAttr(attrs["start"]),
    seeAlso: body.seeAlso,
    sectionPath: sectionPathOf(state),
    parent,
    annotation: trimAnnotation(annotation),
    refs: resolveTodoRefs(state.relPath, [...body.refCandidates, ...annotation.refCandidates]),
  };
}

/** When one paragraph holds two todos, the first one's annotation stops where the second begins. */
function stopAtNextTodo(nodes: Node[]): Node[] {
  const end = nodes.findIndex((node) => isTodoTag(node));
  return end === -1 ? nodes : nodes.slice(0, end);
}

/**
 * Drop the punctuation a human writes to *attach* the note to the todo —
 * " — ", ": ", ", " — so the annotation reads as its own phrase. Only a
 * LEADING run is dropped, so a note that genuinely starts with a dash (an
 * option list, a negative number) keeps everything after the first separator.
 */
function trimAnnotation(flattened: FlattenResult): string {
  return flattened.text.replace(/^[\s‐-―:;,.|·•-]+/u, "").trim();
}

function headingLevel(node: Node): number | null {
  const level = node.attributes["level"];
  return typeof level === "number" && level >= 1 ? level : null;
}

function recordHeading(node: Node, { state, level }: { state: WalkState; level: number }): void {
  state.headings[level] = flattenNodes(node.children).text;
  state.headings.length = level + 1;
}

/** The heading texts in force at this point, outermost first, with skipped levels compacted out. */
function sectionPathOf(state: WalkState): string[] {
  const out: string[] = [];
  for (const heading of state.headings) {
    if (heading !== undefined && heading !== "") out.push(heading);
  }
  return out;
}

function locatorFor(node: Node, state: WalkState): TodoLocator {
  const locator = state.locators.get(node);
  // Every todo tag in this AST was numbered by `assignLocators`, and only todo
  // tags reach here — a miss would mean the two walks disagree about the tree.
  invariant(locator !== undefined, `no locator assigned for a {% todo %} tag in ${state.relPath}`);
  return locator;
}

function lineFor(lines: number[]): string {
  const start = lines[0];
  return typeof start === "number" ? String(start + 1) : "?";
}

function stringAttr(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
