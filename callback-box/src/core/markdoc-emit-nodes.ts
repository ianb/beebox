/**
 * Core Markdoc AST → markdown node walker for the backend emitter.
 *
 * Split out of `markdoc-emit.ts` to keep that file under the line cap. Holds
 * the recursive `emitNode`/`emitChildren` pair plus the block-level helpers
 * (`emitItemChildren`, `emitBlockquote`). Tag rendering lives in the sibling
 * `markdoc-emit-tags.ts`; the walker hands its `emitChildren` to `emitTag` so
 * tag emitters can recurse without a value-import cycle back into this module.
 */

import type { Node } from "@markdoc/markdoc";

import { emitTag } from "./markdoc-emit-tags.js";

export function emitNode(node: Node, out: string[]): void {
  if (emitBlockNode(node, out)) return;
  if (emitInlineNode(node, out)) return;
  // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- deliberately partial walker over Markdoc's external NodeType union (28 members); unhandled node types (tables, html, comments, …) degrade to emitting children. A best-effort renderer must never crash on a new node type. Flagged as a P1-e design question: enumerate vendor node types for compile-time drift detection, or keep graceful degradation?
  switch (node.type) {
    case "inline":
      emitChildren(node, out);
      return;
    case "tag":
      emitTag({ node, out, emitChildren });
      return;
    default:
      // Tables, html, comments, anything else — emit children as a graceful
      // fallback. Briefing bodies aren't expected to use these constructs;
      // if a card relies on one and it doesn't render, that's a finding for
      // a future iteration.
      emitChildren(node, out);
      return;
  }
}

/** Block-level node types. Returns true if handled. */
function emitBlockNode(node: Node, out: string[]): boolean {
  // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- partial predicate over Markdoc's external NodeType union; non-block node types intentionally return false so the caller tries the inline/tag handlers. See the emitNode design-question note.
  switch (node.type) {
    case "document":
      emitChildren(node, out);
      return true;
    case "paragraph":
      emitChildren(node, out);
      out.push("\n\n");
      return true;
    case "heading": {
      const level = typeof node.attributes["level"] === "number" ? node.attributes["level"] : 1;
      out.push(`${"#".repeat(level)} `);
      emitChildren(node, out);
      out.push("\n\n");
      return true;
    }
    case "list":
      emitList(node, out);
      return true;
    case "item":
      // Handled by parent `list`; bare items emit their content with no marker.
      emitItemChildren(node, out);
      return true;
    case "blockquote":
      emitBlockquote(node, out);
      return true;
    case "fence":
      emitFence(node, out);
      return true;
    case "hr":
      out.push("---\n\n");
      return true;
    case "hardbreak":
      out.push("\\\n");
      return true;
    case "softbreak":
      out.push("\n");
      return true;
    default:
      return false;
  }
}

/** Inline/span node types. Returns true if handled. */
function emitInlineNode(node: Node, out: string[]): boolean {
  // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- partial predicate over Markdoc's external NodeType union; non-inline node types intentionally return false so the caller falls through to the graceful default. See the emitNode design-question note.
  switch (node.type) {
    case "text": {
      const content = node.attributes["content"];
      if (typeof content === "string") out.push(content);
      return true;
    }
    case "strong":
      out.push("**");
      emitChildren(node, out);
      out.push("**");
      return true;
    case "em":
      out.push("*");
      emitChildren(node, out);
      out.push("*");
      return true;
    case "s":
      out.push("~~");
      emitChildren(node, out);
      out.push("~~");
      return true;
    case "code": {
      const content = node.attributes["content"];
      if (typeof content === "string") out.push("`" + content + "`");
      return true;
    }
    case "link": {
      const href = typeof node.attributes["href"] === "string" ? node.attributes["href"] : "";
      out.push("[");
      emitChildren(node, out);
      out.push(`](${href})`);
      return true;
    }
    case "image": {
      const src = typeof node.attributes["src"] === "string" ? node.attributes["src"] : "";
      const alt = typeof node.attributes["alt"] === "string" ? node.attributes["alt"] : "";
      out.push(`![${alt}](${src})`);
      return true;
    }
    default:
      return false;
  }
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

export function emitChildren(node: Node, out: string[]): void {
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
