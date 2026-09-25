/**
 * Flattening a span of raw Markdoc nodes to plain text, and turning the refs
 * found along the way into box-relative paths.
 *
 * Both halves belong together because they are one pass: a markdown link's
 * TARGET survives only if it is read from `attributes.href` while the node is
 * still a node — flattening keeps the label and throws the href away. That is
 * the whole reason `core/body-refs.ts` (which re-scans the markdown SOURCE of
 * a whole body) cannot be aimed at one todo: there is no source range for
 * "this todo and the words after it".
 */

import type { Node } from "@markdoc/markdoc";
import { isExternalRef, parseRef, resolveRefPath } from "../../shared/ref-path.js";
import type { TodoSeeAlso } from "./collect-types.js";

export interface FlattenResult {
  /** Whitespace-collapsed plain text. */
  text: string;
  /** `{% see-also %}` tags pulled out of the text, with their own note text. */
  seeAlso: TodoSeeAlso[];
  /** Raw, unresolved ref strings in order of appearance — `see-also` refs and link hrefs interleaved as written. */
  refCandidates: string[];
}

interface FlattenState {
  parts: string[];
  seeAlso: TodoSeeAlso[];
  refCandidates: string[];
}

/**
 * Flatten a span of sibling nodes to text, pulling nested `{% see-also %}`
 * tags out into their own list and recording every ref written inside.
 *
 * A nested `{% todo %}` ENDS the span: a block-form todo's own text stops
 * where its first child todo begins, and one paragraph's two todos do not
 * absorb each other's words.
 */
export function flattenNodes(nodes: Node[]): FlattenResult {
  const state: FlattenState = { parts: [], seeAlso: [], refCandidates: [] };
  walk(nodes, state);
  return {
    text: joinParts(state.parts),
    seeAlso: state.seeAlso,
    refCandidates: state.refCandidates,
  };
}

function walk(nodes: Node[], state: FlattenState): void {
  for (const node of nodes) {
    if (node.type === "tag" && node.tag === "todo") continue;
    if (node.type === "tag" && node.tag === "see-also") {
      state.seeAlso.push(extractSeeAlso(node));
      const ref = stringAttr(node.attributes["ref"]);
      if (ref !== undefined) state.refCandidates.push(ref);
      continue;
    }
    if (node.type === "text") {
      const content = node.attributes["content"];
      if (typeof content === "string") state.parts.push(content);
      continue;
    }
    if (node.type === "softbreak" || node.type === "hardbreak") {
      state.parts.push(" ");
      continue;
    }
    if (node.type === "link") {
      const href = stringAttr(node.attributes["href"]);
      if (href !== undefined) state.refCandidates.push(href);
    }
    walk(node.children, state);
  }
}

/** A `{% see-also %}` tag has no further nested `{% see-also %}` to extract, so its own text-flatten pass discards any (there shouldn't be one). */
function extractSeeAlso(node: Node): TodoSeeAlso {
  const state: FlattenState = { parts: [], seeAlso: [], refCandidates: [] };
  walk(node.children, state);
  const note = joinParts(state.parts);
  return {
    ref: stringAttr(node.attributes["ref"]),
    href: stringAttr(node.attributes["href"]),
    note: note === "" ? undefined : note,
  };
}

/**
 * Resolve raw refs against the card they were written in, keeping the
 * box-relative paths in order of first appearance.
 *
 * A URL, a bare `#anchor`, and anything that escapes the box or leaves the
 * box namespace drop out — `resolveRefPath` fails closed and this is not the
 * place that reports a broken link (`bbx validate` is). What comes back is a
 * PATH, file or directory, never checked for existence: a reference scope
 * matches on the string, and a todo pointing at a card that was deleted
 * should still say so.
 */
export function resolveTodoRefs(relPath: string, candidates: string[]): string[] {
  const out: string[] = [];
  for (const candidate of candidates) {
    if (isExternalRef(candidate)) continue;
    const resolved = resolveRefPath({ fromPath: relPath, ref: parseRef(candidate).path, kind: "card" });
    if (resolved === null) continue;
    if (!out.includes(resolved)) out.push(resolved);
  }
  return out;
}

function stringAttr(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function joinParts(parts: string[]): string {
  return parts.join("").trim().replace(/\s+/gu, " ");
}
