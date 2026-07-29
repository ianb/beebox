/**
 * Raw-AST walk for `{% todo %}` tags inside one card's markdown body.
 *
 * Parses the body once, runs `Markdoc.validate` once, then walks the RAW
 * (pre-transform) AST for `node.tag === "todo"` — the authored lowercase
 * name; `TodoInline`/`TodoBlock` exist only post-transform, where source
 * lines are gone (`body-refs.ts` is the precedent for walking the raw tree).
 *
 * A parse failure, or a validate error attributed to a `{% todo %}`/
 * `{% see-also %}` tag (via `body-markdoc-lint.ts`'s tag-span attribution —
 * an unrelated validate error elsewhere in the body is not this module's
 * concern), makes the WHOLE card's body contribute one visible-invalid
 * result instead of a partial todo list: the plan calls for a card-level
 * signal ("that card contributes a visible-invalid entry"), not a
 * best-effort partial collection that could quietly hide a sibling todo's
 * own errors.
 */

import Markdoc from "@markdoc/markdoc";
import type { Node } from "@markdoc/markdoc";
import { markdocConfig } from "../../shared/markdoc-config.js";
import { collectTagSpans, tagNameFor } from "../body-markdoc-lint.js";
import { deriveTodoPlateState, isTodoStatus, type TodoPlateContext } from "../../shared/todo-model.js";
import { plateInputFor, type CollectedTodo, type TodoSeeAlso } from "./collect-types.js";
import { errorMessage } from "../../lib/error-guards.js";

// Markdoc ships dual CJS/ESM but its `exports` field is null, so Node ESM
// imports resolve to the CJS bundle — which only exposes a default export.
// Same pattern as `body-refs.ts` / `body-markdoc-lint.ts`.
// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
const { parse, validate } = Markdoc;

export type BodyCollectResult =
  | { ok: true; todos: CollectedTodo[] }
  | { ok: false; kind: "parse" | "validate"; message: string };

/** Collect every `{% todo %}` in one card's body. `lineOffset` is the frontmatter's line count (`splitCardContent`), added to a tag's body-relative line to report the true file line. */
export function collectBodyTodos(input: {
  path: string;
  bodyText: string;
  lineOffset: number;
  ctx: TodoPlateContext;
}): BodyCollectResult {
  const { path, bodyText, lineOffset, ctx } = input;
  if (bodyText === "") return { ok: true, todos: [] };

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

  const todos: CollectedTodo[] = [];
  for (const node of ast.walk()) {
    if (node.type !== "tag" || node.tag !== "todo") continue;
    todos.push(buildBodyTodo({ path, node, lineOffset, ctx }));
  }
  return { ok: true, todos };
}

function buildBodyTodo(input: { path: string; node: Node; lineOffset: number; ctx: TodoPlateContext }): CollectedTodo {
  const { path, node, lineOffset, ctx } = input;
  const attrs = node.attributes;
  const id = stringAttr(attrs["id"]);
  const statusRaw = stringAttr(attrs["status"]);
  const status = statusRaw !== undefined && isTodoStatus(statusRaw) ? statusRaw : "open";
  const assigned = stringAttr(attrs["assigned"]);
  const by = stringAttr(attrs["by"]);
  const created = stringAttr(attrs["created"]);
  const due = stringAttr(attrs["due"]);
  const start = stringAttr(attrs["start"]);
  const { text, seeAlso } = flattenBody(node);
  const line = lineOffset + bodyLine(node);
  return {
    path,
    locator: { kind: "body", line },
    id,
    text,
    status,
    assigned,
    by,
    created,
    due,
    start,
    seeAlso,
    plateState: deriveTodoPlateState(plateInputFor({ status, start, due }), ctx),
  };
}

/** Markdoc `lines` are 0-indexed; the tag's opening line, 1-indexed to match the body the human reads. */
function bodyLine(node: Node): number {
  const lines = node.lines;
  return Array.isArray(lines) && typeof lines[0] === "number" ? lines[0] + 1 : 1;
}

function lineFor(lines: number[]): string {
  const start = lines[0];
  return typeof start === "number" ? String(start + 1) : "?";
}

function stringAttr(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

interface FlattenResult {
  text: string;
  seeAlso: TodoSeeAlso[];
}

interface FlattenState {
  parts: string[];
  seeAlso: TodoSeeAlso[];
}

/** Flatten a `{% todo %}` node's children to plain text, pulling nested `{% see-also %}` tags out into their own list (ref/href + note text) instead of the main text. */
function flattenBody(node: Node): FlattenResult {
  const state: FlattenState = { parts: [], seeAlso: [] };
  walkChildren(node, state);
  return { text: joinParts(state.parts), seeAlso: state.seeAlso };
}

function walkChildren(node: Node, state: FlattenState): void {
  for (const child of node.children) {
    if (child.type === "tag" && child.tag === "see-also") {
      state.seeAlso.push(extractSeeAlso(child));
      continue;
    }
    if (child.type === "text") {
      const content = child.attributes["content"];
      if (typeof content === "string") state.parts.push(content);
      continue;
    }
    if (child.type === "softbreak" || child.type === "hardbreak") {
      state.parts.push(" ");
      continue;
    }
    walkChildren(child, state);
  }
}

/** A `{% see-also %}` tag has no further nested `{% see-also %}` to extract, so its own text-flatten pass discards any (there shouldn't be one). */
function extractSeeAlso(node: Node): TodoSeeAlso {
  const ref = stringAttr(node.attributes["ref"]);
  const href = stringAttr(node.attributes["href"]);
  const state: FlattenState = { parts: [], seeAlso: [] };
  walkChildren(node, state);
  const note = joinParts(state.parts);
  return { ref, href, note: note === "" ? undefined : note };
}

function joinParts(parts: string[]): string {
  return parts
    .join("")
    .trim()
    .replace(/\s+/g, " ");
}
