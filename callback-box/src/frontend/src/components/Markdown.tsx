/**
 * Shared Markdown renderer with comment visibility.
 *
 * Wraps react-markdown with remark-gfm and the comment-visibility plugin,
 * so HTML comments render as visible styled text instead of being stripped.
 *
 * Links:
 *  - `view:…` URLs and relative paths are intercepted and handed to the
 *    required `onNavigate` callback so each context (browse page, companion
 *    pane, zoomable view, …) can decide what "open this file" means.
 *  - http(s) links render as normal external links in a new tab.
 *  - Callers that need fully custom link handling (e.g. chat's inline image
 *    rendering) can still override via `components.a`.
 */

import { useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { remarkComments, isCommentCode } from "../lib/remark-comments";
import { href as routeHref } from "../lib/routing";
import {
  classifyMarkdownHref,
  parseViewUrl,
  resolveRelativePath,
  serializeViewUrl,
  type ViewTarget,
} from "../lib/view-url";

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

function viewHref(boxSlug: string | undefined, target: ViewTarget): string {
  return routeHref(`/${boxSlug ?? ""}/views/${serializeViewUrl(target)}`);
}

interface LinkContext {
  onNavigate: (target: ViewTarget) => void;
  basePath: string | undefined;
  boxSlug: string | undefined;
}

function makeDefaultComponents(ctx: LinkContext): Partial<Components> {
  const { onNavigate, basePath, boxSlug } = ctx;
  return {
    a({ children, href: linkHref, node: _node, ...props }) {
      if (typeof linkHref !== "string") {
        return <a {...props}>{children}</a>;
      }
      const classified = classifyMarkdownHref(linkHref);
      if (classified.kind === "view") {
        const target = parseViewUrl(classified.raw);
        const resolvedHref = viewHref(boxSlug, target);
        return (
          <a
            href={resolvedHref}
            onClick={(e) => {
              if (e.defaultPrevented) return;
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              e.preventDefault();
              onNavigate(target);
            }}
            {...props}
          >
            {children}
          </a>
        );
      }
      if (classified.kind === "relative") {
        const resolved = resolveRelativePath(basePath, classified.path);
        const target: ViewTarget = { path: resolved, viewer: null, params: {}, zoom: false };
        const resolvedHref = viewHref(boxSlug, target);
        return (
          <a
            href={resolvedHref}
            onClick={(e) => {
              if (e.defaultPrevented) return;
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              e.preventDefault();
              onNavigate(target);
            }}
            {...props}
          >
            {children}
          </a>
        );
      }
      const isExternal =
        linkHref.startsWith("http://") || linkHref.startsWith("https://");
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
}

function makeCommentComponents(ctx: LinkContext): Partial<Components> {
  return {
    ...makeDefaultComponents(ctx),
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
}

type ProseVariant = false | "block" | "inline";

interface MarkdownProps {
  children: string;
  components?: Partial<Components>;
  /** Show HTML comments as visible styled text. Defaults to false. */
  showComments?: boolean;
  /**
   * Wrap the rendered output in a Tailwind Typography container.
   * - `"block"` — `<div>` wrapper (default for rendered pages).
   * - `"inline"` — `<span>` wrapper (for markdown within flowing text).
   * - `false` (default) — no wrapper; caller decides.
   */
  prose?: ProseVariant;
  /**
   * Required. Called when the user clicks a `view:` or relative link — the
   * caller decides whether to push a URL, swap a sidebar pane, etc. See
   * {@link RendererProps.onNavigate} for the broader contract.
   */
  onNavigate: (target: ViewTarget) => void;
  /**
   * Path of the document being rendered (relative to the box root). Used to
   * resolve relative links like `[1040](1040.pdf)` against the document's
   * own directory. If omitted, relative links are treated as already
   * box-root-relative.
   */
  basePath?: string;
}

export function Markdown({
  children,
  components,
  showComments,
  prose = false,
  onNavigate,
  basePath,
}: MarkdownProps) {
  const { boxSlug } = useParams({ strict: false });
  const plugins = showComments ? pluginsWithComments : defaultPlugins;
  const defaultBase = useMemo(
    () => {
      const ctx: LinkContext = { onNavigate, basePath, boxSlug };
      return showComments ? makeCommentComponents(ctx) : makeDefaultComponents(ctx);
    },
    [showComments, onNavigate, basePath, boxSlug],
  );
  const merged = components
    ? { ...defaultBase, ...components }
    : defaultBase;

  const rendered = (
    <ReactMarkdown
      remarkPlugins={plugins}
      components={merged}
      urlTransform={viewUrlTransform}
    >
      {children}
    </ReactMarkdown>
  );

  if (prose === "block") {
    return <div className="prose prose-sm max-w-none text-warm-700">{rendered}</div>;
  }
  if (prose === "inline") {
    return <span className="prose prose-sm inline max-w-none">{rendered}</span>;
  }
  return rendered;
}
