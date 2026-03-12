/**
 * Shared Markdown renderer with comment visibility.
 *
 * Wraps react-markdown with remark-gfm and the comment-visibility plugin,
 * so HTML comments render as visible styled text instead of being stripped.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { remarkComments, isCommentCode } from "../lib/remark-comments";

const defaultPlugins = [remarkGfm];
const pluginsWithComments = [remarkGfm, remarkComments];

const commentComponents: Partial<Components> = {
  code({ children, ...props }) {
    const text = typeof children === "string" ? children : "";
    if (isCommentCode(text)) {
      return (
        <code
          {...props}
          className="text-warm-400 italic font-normal bg-transparent"
        >
          {text}
        </code>
      );
    }
    return <code {...props}>{children}</code>;
  },
};

interface MarkdownProps {
  children: string;
  components?: Partial<Components>;
  /** Show HTML comments as visible styled text. Defaults to false. */
  showComments?: boolean;
}

export function Markdown({ children, components, showComments }: MarkdownProps) {
  const plugins = showComments ? pluginsWithComments : defaultPlugins;
  const baseComponents = showComments ? commentComponents : {};
  const merged = components
    ? { ...baseComponents, ...components }
    : baseComponents;

  return (
    <ReactMarkdown
      remarkPlugins={plugins}
      components={merged}
    >
      {children}
    </ReactMarkdown>
  );
}
