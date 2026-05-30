/**
 * Markdoc parser config shared between the frontend React renderer and
 * any backend Markdoc consumer (currently `body-refs.ts`'s body walker;
 * eventually Track 2's `compileBriefing` AST → markdown emitter).
 *
 * **Pure TypeScript only.** No React, no `fs`/Node-only APIs, no DOM
 * imports. Both tsconfigs (`tsconfig.json` for backend, `src/frontend/
 * tsconfig.json` for frontend) include this directory. The
 * frontend imports via the `@shared/*` path alias; backend uses
 * relative paths.
 *
 * Markdoc replaces the previous react-markdown + remark/rehype stack. All
 * markdown bodies in the box render through this config: doc cards, memos,
 * chat narration, recipe notes, commit bodies — everything that previously
 * went through react-markdown.
 *
 * Tag library so far:
 *  - `quote` — direct quote from a person (verbatim words). Inline if the
 *    tag body has no newlines, block otherwise. The tag transforms into
 *    either `QuoteInline` or `QuoteBlock` based on `node.inline`, so the
 *    React component for each shape can be specialized.
 *  - `source` — universal provenance tag: where the wrapped content
 *    came from and (optionally) how it was derived. Required `ref`
 *    (which feeds Track 4's body ref-tracking automatically). Optional
 *    `as` — natural-language description of the derivation
 *    ("verbatim", "summary", "inferred from the address", …). Inline/
 *    block split same as `quote`.
 *  - `task` — internal: GFM task-list checkbox. Not authored directly;
 *    the `item` node transform below detects leading `[ ]` / `[x]` in a
 *    list item's first text run and rewrites it to a `Task` tag, since
 *    Markdoc's CommonMark base doesn't handle GFM task lists itself and
 *    has no plugin surface for adding them.
 *
 * Add new tags here. Use Markdoc's `attributes` schema for typed/validated
 * attributes — `Markdoc.validate(ast, config)` then catches misuse at parse
 * time, which is what `cb validate` calls into.
 */

import { Tag, nodes as baseNodes, type Config, type RenderableTreeNode, type Schema } from "@markdoc/markdoc";

const quote: Schema = {
  attributes: {
    from: { type: String },
  },
  transform(node, config) {
    const attributes = node.transformAttributes(config);
    const children = node.transformChildren(config);
    return new Tag(node.inline ? "QuoteInline" : "QuoteBlock", attributes, children);
  },
};

const source: Schema = {
  attributes: {
    ref: { type: String, required: true },
    as: { type: String },
  },
  transform(node, config) {
    // Markdoc-side attribute is `ref` (which is also what Track 4's body
    // ref-tracking walks for and what the cardworks frontmatter convention
    // uses). React reserves `ref` as a special prop on components, so we
    // rename to `sourceRef` in the renderable tree — the React component
    // only ever sees the non-reserved name.
    const { ref, ...rest } = node.transformAttributes(config) as { ref?: string };
    const renamed = ref === undefined ? rest : { ...rest, sourceRef: ref };
    const children = node.transformChildren(config);
    return new Tag(node.inline ? "SourceInline" : "SourceBlock", renamed, children);
  },
};

const task: Schema = {
  selfClosing: true,
  attributes: {
    done: { type: Boolean, default: false },
  },
  transform(node, config) {
    return new Tag("Task", node.transformAttributes(config), []);
  },
};

/**
 * `item` node override that recognises GFM task-list markers. If the first
 * rendered child is a string starting with `[ ] ` / `[x] ` / `[X] `, that
 * prefix is stripped and a `Task` tag is prepended in its place. Runs after
 * the markdown-it tokenizer, so code-fence content is never mistaken for a
 * task item.
 */
const item: Schema = {
  ...baseNodes.item,
  transform(node, config) {
    const children = node.transformChildren(config);
    const rewritten = rewriteTaskPrefix(children);
    return new Tag("li", {}, rewritten);
  },
};

const TASK_PREFIX_RE = /^\[([ Xx])]\s+/;

function rewriteTaskPrefix(children: RenderableTreeNode[]): RenderableTreeNode[] {
  if (children.length === 0) return children;
  const first = children[0];
  if (typeof first !== "string") return children;
  const match = TASK_PREFIX_RE.exec(first);
  if (match === null) return children;
  const done = match[1] !== " ";
  const remainder = first.slice(match[0].length);
  const taskTag = new Tag("Task", { done }, []);
  const rest = children.slice(1);
  return remainder === "" ? [taskTag, ...rest] : [taskTag, remainder, ...rest];
}

export const markdocConfig: Config = {
  tags: { quote, source, task },
  nodes: { item },
};
