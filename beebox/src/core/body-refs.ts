/**
 * Walk a card's markdown body for the refs it carries: Markdoc tag attributes
 * (`extractBodyRefs`) and inline markdown links/images (`extractBodyLinks`).
 *
 * Cardworks' `extractRefs` (which `card-lint.ts` uses) walks structured
 * frontmatter fields only — it identifies refs by key name (`ref` /
 * `refs`) in parsed objects. Card bodies are strings as far as cardworks
 * is concerned, so refs embedded in body Markdoc tags (e.g.
 * `{% source ref="/people/Dana_Lee.person.card" %}`) slip
 * past the field walker.
 *
 * This complement parses the body with Markdoc and walks every tag node
 * for an attribute literally named `ref`. Same convention as the
 * frontmatter side: attribute name `ref` carries a card or file ref;
 * anything else is treated as an opaque attribute value.
 *
 * Lives in beebox (not cardworks) on purpose: cardworks is body-
 * format-agnostic, and which-body-syntax-carries-refs is beebox's
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
import { isExternalRef } from "../shared/ref-path.js";

// eslint-disable-next-line import-x/no-named-as-default-member
const { parse } = Markdoc;

export interface BodyRef {
  /** Display path for the warning — `body:<line>:<tagName>.<attr>` or `body:<line>:link`. */
  path: string;
  /** The ref value. */
  ref: string;
}

/**
 * THE pattern for an inline markdown link/image target in card-ish text:
 * `[text](path)` / `![alt](path)`, capturing the opening `…](` run and the
 * target token separately so a rewriter can splice a replacement in.
 *
 * A factory rather than a shared `const` because it is `/g` — a module-level
 * global regex carries `lastIndex` between callers, which is a classic
 * skipped-match bug. One definition, two consumers: this module's
 * `extractBodyLinks` (validate side) and `rewrite-card-refs.ts` (`bbx mv`).
 */
export function inlineLinkPattern(): RegExp {
  return /(!?\[[^\]]*]\(\s*)([^\s()]+)/g;
}

/**
 * Inline markdown links and images in a card body, as refs to check.
 *
 * `bbx mv` has always *rewritten* these; validate never checked them, so a link
 * that broke by hand-edit or deletion stayed silent. External targets (a URL
 * scheme, protocol-relative `//host`, a bare `#anchor`, empty) are skipped —
 * they name nothing in the box.
 *
 * Like BBX002's `extractInlineLinks`, this is a plain text scan: a link inside a
 * fenced code block is extracted like any other. That over-reports a
 * deliberately-illustrative link in a code fence as a broken ref; matching
 * BBX002's posture is preferred over two different answers to "is this a link".
 */
export function extractBodyLinks(body: string): BodyRef[] {
  if (body === "") return [];
  const out: BodyRef[] = [];
  for (const match of body.matchAll(inlineLinkPattern())) {
    const ref = match[2];
    if (ref === undefined || isExternalRef(ref)) continue;
    out.push({ path: `body:${String(lineAt(body, match.index))}:link`, ref });
  }
  out.push(...extractReferenceDefinitions(body));
  return out;
}

/**
 * A destination token in a markdown reference-style link definition, per
 * CommonMark's link-destination grammar: either angle-bracket delimited
 * (`<…>`, no unescaped `<`, `>`, or line ending inside — the delimiters are
 * stripped, not part of the returned url) or a bare run of non-whitespace
 * characters. `text` is searched starting at its first character (NOT
 * anchored to the start of a line — callers pass in whatever text follows
 * the `[id]:` label, which may itself start with whitespace to skip).
 */
function matchDestination(text: string): { url: string; offset: number } | null {
  const leading = /^[\t ]*/.exec(text)?.[0].length ?? 0;
  const rest = text.slice(leading);
  const angle = /^<([^\n<>]*)>/.exec(rest);
  if (angle !== null) {
    const url = angle[1];
    if (url === undefined) return null;
    return { url, offset: leading + 1 }; // +1 skips the opening `<`
  }
  const bare = /^(\S+)/.exec(rest);
  if (bare === null) return null;
  const url = bare[1];
  if (url === undefined) return null;
  return { url, offset: leading };
}

/**
 * A markdown reference-style link DEFINITION: `[id]: /path "title"`, or
 * `[id]: </path with spaces>` (angle-bracket delimited destination), or with
 * the destination on the line AFTER the label when nothing but whitespace
 * follows the colon:
 * ```
 * [id]:
 *   /path
 * ```
 * All three are legal CommonMark, and the Markdoc parser this codebase
 * already renders/lints with resolves all three to a real link — so an
 * extractor that only understood same-line destinations was silently
 * invisible to a form its own renderer treats as a working link. Neither the
 * inline-link pattern above nor `ref="…"`/frontmatter walking sees this form
 * at all — a `[text][id]` USAGE carries no path, only the definition does.
 *
 * `lines[labelLineIndex]` must start the label (optionally indented up to 3
 * spaces, per CommonMark); a continuation destination is only recognized on
 * the immediately following line (a blank line in between means no
 * definition, matching CommonMark and this codebase's Markdoc parser — see
 * `body-refs.doctest.md`). Returns the destination's line index (the label
 * line, or the line after it for the continuation form) and its character
 * offset within that line, with any angle-bracket delimiters already
 * stripped, so a rewriter can splice a replacement in without disturbing the
 * rest of the line and without ever producing a ref value containing `<`/`>`.
 *
 * Exported (not just used internally) so `markdown-lint-rules.ts`'s
 * line-based `extractInlineLinks` and the one-root migration's ref rewriter
 * share this one grammar instead of each growing its own regex for the same
 * form.
 */
export function matchReferenceDefinitionAt(
  lines: readonly string[],
  labelLineIndex: number,
): { url: string; lineIndex: number; index: number } | null {
  const labelLine = lines[labelLineIndex];
  if (labelLine === undefined) return null;
  const label = /^[\t ]{0,3}\[[^\]]+]:(.*)$/.exec(labelLine);
  if (label === null) return null;
  const afterColon = label[1] ?? "";
  if (afterColon.trim() !== "") {
    const dest = matchDestination(afterColon);
    if (dest === null) return null;
    return { url: dest.url, lineIndex: labelLineIndex, index: labelLine.length - afterColon.length + dest.offset };
  }
  // Nothing but whitespace after the colon: CommonMark allows the
  // destination on the next line, but only when that line isn't blank —
  // a blank line ends the definition (and starts a new block) instead.
  const nextLine = lines[labelLineIndex + 1];
  if (nextLine === undefined || nextLine.trim() === "") return null;
  const dest = matchDestination(nextLine);
  if (dest === null) return null;
  return { url: dest.url, lineIndex: labelLineIndex + 1, index: dest.offset };
}

/** Every reference-style link definition in `body`, as refs to check. */
export function extractReferenceDefinitions(body: string): BodyRef[] {
  if (body === "") return [];
  const out: BodyRef[] = [];
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const found = matchReferenceDefinitionAt(lines, i);
    if (found === null || isExternalRef(found.url)) continue;
    out.push({ path: `body:${String(found.lineIndex + 1)}:ref-def`, ref: found.url });
  }
  return out;
}

/** 1-indexed line number of an offset into `body`, to match the body a human reads. */
function lineAt(body: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (body[i] === "\n") line++;
  }
  return line;
}

export function extractBodyRefs(body: string): BodyRef[] {
  if (body === "") return [];
  let ast: Node;
  try {
    ast = parse(body);
  } catch (_e) {
    // Intentional: per this module's header, a Markdoc parse failure means
    // "no body refs found". Markdoc parses any legal CommonMark (a superset),
    // so this is rare; when it happens we'd rather miss a few ref warnings than
    // fail card validation, and the agent still gets the parse error via the
    // separate Markdoc.validate path the frontend runs.
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
