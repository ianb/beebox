/**
 * Remark plugin that makes HTML comments visible in rendered output.
 *
 * By default, react-markdown strips HTML comments. This plugin transforms
 * comment `html` nodes in the AST into paragraph nodes containing styled
 * inline code, so the comment text is visible in the rendered output.
 *
 * To style comments, add CSS for `.md-comment` — the plugin wraps the
 * rendered `<code>` with a custom component via the `code` prop on
 * ReactMarkdown.
 */

import type { Root, Html, InlineCode, Paragraph } from "mdast";
import type { Plugin } from "unified";

/** Marker prefix/suffix so the `code` component can identify comment nodes. */
const COMMENT_MARKER = "<!-- ";
const COMMENT_MARKER_END = " -->";

const remarkComments: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visit(tree);
  };
};

function visit(node: { children?: Array<{ type: string }> }): void {
  if (!node.children) return;

  const children = node.children as Array<{ type: string }>;
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i]!;

    if (child.type === "html") {
      const htmlNode = child as Html;
      const match = /^<!--([\S\s]*?)-->$/.exec(htmlNode.value.trim());
      if (match) {
        const commentText = match[1]!.trim();
        const codeNode: InlineCode = {
          type: "inlineCode",
          value: `${COMMENT_MARKER}${commentText}${COMMENT_MARKER_END}`,
        };
        const para: Paragraph = {
          type: "paragraph",
          children: [codeNode],
        };
        children.splice(i, 1, para as typeof children[number]);
        continue;
      }
    }

    if ("children" in child) {
      visit(child as typeof node);
    }
  }
}

/**
 * Check if a code node's text is a rendered comment.
 */
function isCommentCode(value: string): boolean {
  return value.startsWith(COMMENT_MARKER) && value.endsWith(COMMENT_MARKER_END);
}

export { remarkComments, isCommentCode };
