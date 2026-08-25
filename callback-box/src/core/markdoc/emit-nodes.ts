/**
 * Core Markdoc AST → markdown node walker for the backend emitter.
 *
 * Split out of `markdoc/emit.ts` to keep that file under the line cap. Holds
 * the recursive `emitNode`/`emitChildren` pair plus the block-level helpers
 * (`emitItemChildren`, `emitBlockquote`). Tag rendering lives in the sibling
 * `markdoc/emit-tags.ts`; the walker hands its `emitChildren` to `emitTag` so
 * tag emitters can recurse without a value-import cycle back into this module.
 *
 * **Dispatch shape.** `nodeHandlers` is a `Record<NodeType, NodeHandler>`
 * over Markdoc's external 28-member `NodeType` union — the `satisfies`
 * clause makes a missing member a compile error, so a Markdoc upgrade that
 * adds a node type fails the build here instead of silently mis-rendering.
 * This is the `Record`-with-`satisfies` idiom from code-style.md's
 * Exhaustiveness section ("the idiom for a wide/shallow union where a long
 * case list would be noise") rather than a `switch`: a 28-case `switch`
 * blows the `complexity` lint budget no matter how the cases are grouped
 * (ESLint's `complexity` rule counts every `case` label, fallthrough or
 * not), while the object literal here has none of that branching cost.
 * `nodeHandlers[node.type]` is still typed `NodeHandler | undefined`
 * (`noUncheckedIndexedAccess`) for the case where a *deployed* build is
 * older than the Markdoc version actually running — `tolerateNever`
 * (`src/lib/invariant.ts`) covers that gap at runtime: it logs and the
 * walker degrades by emitting the node's children rather than crashing.
 * Many members share the same "degrade to children" handler — tables,
 * comments, parse errors, and the generic base `node` type — grouped below
 * with one comment per group naming what's lost.
 */

import type { Node, NodeType } from "@markdoc/markdoc";

import { tolerateNever } from "../../lib/invariant.js";
import { emitTag } from "./emit-tags.js";

type NodeHandler = (node: Node, out: string[]) => void;

/** Emit a node's children with no wrapping — the shared graceful fallback. */
function degrade(node: Node, out: string[]): void {
  emitChildren(node, out);
}

const nodeHandlers = {
  document: degrade,
  paragraph: (node, out) => {
    emitChildren(node, out);
    out.push("\n\n");
  },
  heading: (node, out) => {
    const level = typeof node.attributes["level"] === "number" ? node.attributes["level"] : 1;
    out.push(`${"#".repeat(level)} `);
    emitChildren(node, out);
    out.push("\n\n");
  },
  list: emitList,
  // Handled by parent `list`; a bare `item` (no enclosing list) emits its
  // content with no marker.
  item: emitItemChildren,
  blockquote: emitBlockquote,
  fence: emitFence,
  hr: (_node, out) => out.push("---\n\n"),
  hardbreak: (_node, out) => out.push("\\\n"),
  softbreak: (_node, out) => out.push("\n"),

  inline: degrade,
  tag: (node, out) => emitTag({ node, out, emitChildren }),

  text: (node, out) => {
    const content = node.attributes["content"];
    if (typeof content === "string") out.push(content);
  },
  strong: (node, out) => {
    out.push("**");
    emitChildren(node, out);
    out.push("**");
  },
  em: (node, out) => {
    out.push("*");
    emitChildren(node, out);
    out.push("*");
  },
  s: (node, out) => {
    out.push("~~");
    emitChildren(node, out);
    out.push("~~");
  },
  code: (node, out) => {
    const content = node.attributes["content"];
    if (typeof content === "string") out.push("`" + content + "`");
  },
  link: (node, out) => {
    const href = typeof node.attributes["href"] === "string" ? node.attributes["href"] : "";
    out.push("[");
    emitChildren(node, out);
    out.push(`](${href})`);
  },
  image: (node, out) => {
    const src = typeof node.attributes["src"] === "string" ? node.attributes["src"] : "";
    const alt = typeof node.attributes["alt"] === "string" ? node.attributes["alt"] : "";
    out.push(`![${alt}](${src})`);
  },

  // GFM table structure. Briefing bodies aren't expected to use tables;
  // degrade by emitting children — cell/row text runs together with no
  // grid or separators.
  table: degrade,
  thead: degrade,
  tbody: degrade,
  tr: degrade,
  th: degrade,
  td: degrade,

  // Markdoc's own `{% /* ... */ %}` comment syntax carries no textual
  // content worth emitting standalone; degrade to (usually empty) children.
  comment: degrade,
  // A parse error node. Degrading to children (usually none) means a
  // malformed tag silently drops rather than crashing the renderer.
  error: degrade,
  // Markdoc's generic/base node type — not expected to appear in a parsed
  // AST, but degrades the same way if it ever does.
  node: degrade,
} satisfies Record<NodeType, NodeHandler>;

export function emitNode(node: Node, out: string[]): void {
  const handler: NodeHandler | undefined = nodeHandlers[node.type];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- `node.type` crosses the Markdoc vendor boundary: TS's static NodeType union isn't runtime-enforced by the parser, so `nodeHandlers` being statically exhaustive over the declared union doesn't guarantee a real AST node's `.type` is always a declared member.
  if (handler) {
    handler(node, out);
    return;
  }
  // A vendor NodeType this build's `nodeHandlers` doesn't know about —
  // possible if a real AST node's `.type` falls outside the declared union
  // at runtime even though `nodeHandlers` is statically exhaustive over it
  // (the `satisfies` clause proves compile-time completeness, not runtime
  // agreement with a vendor-boundary value). `node.type as never` mirrors
  // `assertNever`'s own doctest pattern for feeding an off-union value to a
  // never-parameter guard.
  // eslint-disable-next-line no-restricted-syntax -- feeds an off-union vendor value to tolerateNever's `never` param (see comment above); mirrors assertNever's doctest pattern, runtime-fallback only
  tolerateNever(node.type as never, "emitNode: unhandled Markdoc NodeType");
  emitChildren(node, out);
}

function emitList(node: Node, out: string[]): void {
  const ordered = node.attributes["ordered"] === true;
  let index = 1;
  for (const item of node.children) {
    if (item.type !== "item") continue;
    out.push(ordered ? `${index}. ` : "- ");
    index++;
    emitItemChildren(item, out);
    out.push("\n");
  }
  out.push("\n");
}

function emitFence(node: Node, out: string[]): void {
  const content = typeof node.attributes["content"] === "string"
    ? node.attributes["content"]
    : "";
  // Markdoc parses the fence's first-line argument string as `language`;
  // the full info-string isn't preserved separately, so we emit just the
  // language token. Bodies that need post-fence args (e.g. `ts setup`)
  // can't be round-tripped through here — same limitation as `format()`.
  const lang = typeof node.attributes["language"] === "string"
    ? node.attributes["language"]
    : "";
  out.push("```" + lang + "\n");
  out.push(content);
  if (!content.endsWith("\n")) out.push("\n");
  out.push("```\n\n");
}

function emitChildren(node: Node, out: string[]): void {
  for (const child of node.children) emitNode(child, out);
}

/** Emit a list item's children inline (no marker — parent emits that). */
function emitItemChildren(item: Node, out: string[]): void {
  // Items usually contain a single paragraph plus optional nested lists.
  // Emit paragraph content inline (no trailing blank line); nested lists
  // get indented.
  for (const child of item.children) {
    if (child.type === "paragraph") {
      emitChildren(child, out);
    } else if (child.type === "list") {
      const buf: string[] = [];
      emitNode(child, buf);
      const indented = buf.join("").trimEnd().split("\n").map((line) => "  " + line).join("\n");
      out.push("\n" + indented);
    } else {
      emitNode(child, out);
    }
  }
}

function emitBlockquote(node: Node, out: string[]): void {
  const buf: string[] = [];
  emitChildren(node, buf);
  const text = buf.join("").trimEnd();
  for (const line of text.split("\n")) {
    out.push(line === "" ? ">\n" : `> ${line}\n`);
  }
  out.push("\n");
}
