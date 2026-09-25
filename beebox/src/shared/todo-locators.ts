/**
 * A `{% todo %}` tag's identity within one card's body, and the one pass
 * that assigns it — moved here (from `core/todo/extract-body.ts`,
 * `docs/plans/todos-ui.md` Track 2) so the render path (the frontend's
 * `Markdoc.transform`, `Markdown.tsx`) and the collector
 * (`core/todo/extract-body.ts`) number a line's todos with the SAME
 * algorithm. If each walked and counted separately they could disagree
 * about which todo `line#2` means, and a tick could edit the wrong one.
 *
 * Pure and bundler-safe per `docs/module-map.md`: no Node-only imports,
 * only Markdoc's own (isomorphic) `Node` type.
 */

import type { Node } from "@markdoc/markdoc";
import { z } from "zod";

/**
 * Where a todo lives within its card: a body `{% todo %}` tag (line,
 * 1-indexed, in the FILE, not the body) or an entry in the frontmatter
 * `todos:` list (index).
 *
 * A line can hold more than one todo — `{% todo %}Appraise{% /todo %} — ask
 * Marisol {% todo %}Insure{% /todo %}` is two — so the line alone is not an
 * identity. `nth` (1-based, in document order on that line) separates them,
 * and is OMITTED for the first: `path:line` stays exactly what it has always
 * been for the todo a human means when they cite a line, and only the second
 * and later ones grow the `#2` suffix.
 */
export type TodoLocator = { kind: "body"; line: number; nth?: number } | { kind: "frontmatter"; index: number };

/**
 * `TodoLocator` at a boundary (a tRPC input, a state file), with `nth`
 * omitted rather than `undefined` for the first todo on a line
 * (`exactOptionalPropertyTypes`).
 */
export const TodoLocatorSchema = z.union([
  z.object({ kind: z.literal("body"), line: z.number().int().min(1), nth: z.number().int().min(2).optional() })
    .transform(({ line, nth }): TodoLocator => (nth === undefined ? { kind: "body", line } : { kind: "body", line, nth })),
  z.object({ kind: z.literal("frontmatter"), index: z.number().int().min(0) }),
]);

/**
 * Every todo tag's locator, assigned in one document-order pass BEFORE any
 * walk that consumes it. A line can carry several todos, so identity is
 * `line` plus a 1-based `nth` within that line — omitted for the first,
 * which keeps `path:line` the address a human writes for it.
 *
 * It happens up front (in `core/todo/extract-body.ts`) because that walk
 * does not meet the tags in document order: a list item's owner todo is
 * found by looking at its LAST todo before the first is built, so numbering
 * as the walk goes would count backwards on exactly the line this exists
 * for.
 */
export function assignLocators(root: Node, lineOffset: number): Map<Node, TodoLocator> {
  const locators = new Map<Node, TodoLocator>();
  const perLine = new Map<number, number>();
  const walk = (node: Node): void => {
    for (const child of node.children) {
      if (isTodoTag(child)) {
        const line = lineOffset + bodyLine(child);
        const nth = (perLine.get(line) ?? 0) + 1;
        perLine.set(line, nth);
        locators.set(child, nth === 1 ? { kind: "body", line } : { kind: "body", line, nth });
      }
      walk(child);
    }
  };
  walk(root);
  return locators;
}

/** True for a raw (pre-transform) `{% todo %}` tag node, its authored lowercase name. */
export function isTodoTag(node: Node): boolean {
  return node.type === "tag" && node.tag === "todo";
}

/** Markdoc `lines` are 0-indexed; the tag's opening line, 1-indexed to match the body the human reads. */
function bodyLine(node: Node): number {
  const lines = node.lines;
  return Array.isArray(lines) && typeof lines[0] === "number" ? lines[0] + 1 : 1;
}

/**
 * Carrying a locator from the parsed AST into the Markdoc `todo` transform
 * (`markdoc-config.ts`), for the render path (`Markdown.tsx`).
 *
 * A `Map<Node, TodoLocator>` cannot be looked up from inside the transform:
 * `Markdoc.transform` first runs `resolve`, which CLONES every node
 * (`Object.assign(new Node(), this, …)`, `@markdoc/markdoc` `ast/node.ts`),
 * so the transform sees different objects than `assignLocators` keyed. The
 * clone copies own enumerable properties, symbol keys included, so the
 * locator rides on the node under a module-private symbol. Source text cannot
 * produce a symbol-keyed property, which is what keeps an author-written
 * `locator=` attribute from ever standing in for one (it is also undeclared,
 * so Markdoc drops it from the transformed attributes). The doctest
 * `test/shared/todo-locators-render.doctest.md` pins the clone behaviour, so a
 * Markdoc upgrade that changes it fails there rather than silently dropping
 * every rendered todo's locator.
 */
const LOCATOR_KEY: unique symbol = Symbol("bbx.todoLocator");

/** Stamp each todo node with its locator, in place, before `Markdoc.transform`. */
export function stampLocators(locators: Map<Node, TodoLocator>): void {
  for (const [node, locator] of locators) Reflect.set(node, LOCATOR_KEY, locator);
}

/** The locator {@link stampLocators} put on this node (or on the node it was cloned from), if any. */
export function stampedLocator(node: Node): TodoLocator | undefined {
  const value: unknown = Reflect.get(node, LOCATOR_KEY);
  return isTodoLocator(value) ? value : undefined;
}

function isTodoLocator(value: unknown): value is TodoLocator {
  if (typeof value !== "object" || value === null) return false;
  if (!("kind" in value)) return false;
  if (value.kind === "frontmatter") return "index" in value && typeof value.index === "number";
  return value.kind === "body" && "line" in value && typeof value.line === "number";
}
