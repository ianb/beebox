/**
 * Walk a card's markdown body for refs carried by Markdoc tag attributes.
 *
 * Cardworks' `extractRefs` (which `card-lint.ts` uses) walks structured
 * frontmatter fields only — it identifies refs by key name (`ref` /
 * `refs`) in parsed objects. Card bodies are strings as far as cardworks
 * is concerned, so refs embedded in body Markdoc tags (e.g.
 * `{% source ref="..." %}`, `{% key-person ref="people/dana" %}`) slip
 * past the field walker.
 *
 * This complement parses the body with Markdoc and walks every tag node
 * for an attribute literally named `ref`. Same convention as the
 * frontmatter side: attribute name `ref` carries a card or file ref;
 * anything else is treated as an opaque attribute value.
 *
 * Lives in callback-box (not cardworks) on purpose: cardworks is body-
 * format-agnostic, and which-body-syntax-carries-refs is callback-box's
 * choice. Markdoc is one such syntax; future schemas with a different
 * body format would write their own extractor and merge results.
 *
 * Parse errors are swallowed and treated as "no refs found." Markdoc
 * parsing of a body that's also legal CommonMark almost always succeeds
 * (it's a superset), but malformed tag syntax could in principle throw —
 * if it does, we'd rather miss a few ref warnings than fail validation
 * of an otherwise-good card. The agent gets the parse error via the
 * separate `Markdoc.validate` path that the frontend already runs.
 */

// Markdoc ships dual CJS/ESM but its `exports` field is null, so Node
// ESM imports resolve to the CJS bundle — which only exposes a default
// export. Vite bundles the .mjs file on the frontend, so the frontend
// can use named imports; the backend can't. Pull `parse` off the default.
import Markdoc from "@markdoc/markdoc";
import type { Node } from "@markdoc/markdoc";

// eslint-disable-next-line import-x/no-named-as-default-member
const { parse } = Markdoc;

export interface BodyRef {
  /** Display path for the warning — `body:<line>:<tagName>.<attr>`. */
  path: string;
  /** The ref value. */
  ref: string;
}

export function extractBodyRefs(body: string): BodyRef[] {
  if (body === "") return [];
  let ast: Node;
  try {
    ast = parse(body);
  } catch {
    return [];
  }
  const out: BodyRef[] = [];
  for (const node of ast.walk()) {
    if (node.type !== "tag") continue;
    const tagName = node.tag === undefined ? "tag" : node.tag;
    const line = lineFor(node);
    for (const [attrName, attrValue] of Object.entries(node.attributes)) {
      if (attrName !== "ref") continue;
      if (typeof attrValue !== "string") continue;
      out.push({
        path: `body:${line}:${tagName}.${attrName}`,
        ref: attrValue,
      });
    }
  }
  return out;
}

/**
 * Markdoc node `lines` is `[startLine, endLine]` (0-indexed). Display
 * as a 1-indexed line number to match the body the human is reading.
 * Empty / undefined falls back to "?".
 */
function lineFor(node: Node): string {
  const lines = node.lines;
  if (!Array.isArray(lines) || lines.length === 0) return "?";
  const start = lines[0];
  if (typeof start !== "number") return "?";
  return String(start + 1);
}
