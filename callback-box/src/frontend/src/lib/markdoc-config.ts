/**
 * Markdoc parser config for the shared `<Markdown>` component.
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

import { Tag, nodes as baseNodes, type Config, type Node, type RenderableTreeNode, type Schema } from "@markdoc/markdoc";

const quote: Schema = {
  attributes: {
    from: { type: String },
  },
  transform(node: Node, config: Config) {
    const attributes = node.transformAttributes(config);
    const children = node.transformChildren(config);
    return new Tag(node.inline ? "QuoteInline" : "QuoteBlock", attributes, children);
  },
};

const task: Schema = {
  selfClosing: true,
  attributes: {
    done: { type: Boolean, default: false },
  },
  transform(node: Node, config: Config) {
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
  transform(node: Node, config: Config) {
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
  tags: { quote, task },
  nodes: { item },
};
