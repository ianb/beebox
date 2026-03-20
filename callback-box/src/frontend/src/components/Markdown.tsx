/**
 * Shared Markdown renderer with comment visibility.
 *
 * Wraps react-markdown with remark-gfm and the comment-visibility plugin,
 * so HTML comments render as visible styled text instead of being stripped.
 */

import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { remarkComments, isCommentCode } from "../lib/remark-comments";

/**
 * URL transform that preserves view: URLs (used for embedding views in chat)
 * while delegating everything else to react-markdown's default sanitization.
 */
function viewUrlTransform(url: string): string {
  if (url.startsWith("view:")) {
    return url;
  }
  return defaultUrlTransform(url);
}

const defaultPlugins = [remarkGfm];
const pluginsWithComments = [remarkGfm, remarkComments];

/** Open external links in new tabs */
const baseComponents: Partial<Components> = {
  a({ children, href: linkHref, node: _node, ...props }) {
    const isExternal = linkHref && (linkHref.startsWith("http://") || linkHref.startsWith("https://"));
    return (
      <a
        href={linkHref}
        {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        {...props}
      >
        {children}
      </a>
    );
  },
};

const commentComponents: Partial<Components> = {
  ...baseComponents,
  code({ children, node: _node, ...props }) {
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
  const defaultBase = showComments ? commentComponents : baseComponents;
  const merged = components
    ? { ...defaultBase, ...components }
    : defaultBase;

  return (
    <ReactMarkdown
      remarkPlugins={plugins}
      components={merged}
      urlTransform={viewUrlTransform}
    >
      {children}
    </ReactMarkdown>
  );
}
