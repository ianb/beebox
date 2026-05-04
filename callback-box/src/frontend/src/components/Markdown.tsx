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
import rehypeRaw from "rehype-raw";
import type { Components } from "react-markdown";
import { remarkComments, isCommentCode } from "../lib/remark-comments";
import { href as routeHref } from "../lib/routing";
import { Image } from "./ui/Image";
import {
  classifyMarkdownHref,
  parseViewUrl,
  resolveImageSrc,
  resolveRelativePath,
  serializeViewUrl,
  type NavigateHint,
  type ViewTarget,
} from "../lib/view-url";
import type { ReactNode } from "react";

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
const rehypePlugins = [rehypeRaw];

function viewHref(boxSlug: string | undefined, target: ViewTarget): string {
  return routeHref(`/${boxSlug ?? ""}/views/${serializeViewUrl(target)}`);
}

interface LinkContext {
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  basePath: string | undefined;
  boxSlug: string | undefined;
}

/** Flatten React link children to a plain string for use as a tab label. */
function flattenText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (typeof node === "object") {
    const maybe = node as { props?: { children?: ReactNode } };
    if (maybe.props && "children" in maybe.props) return flattenText(maybe.props.children);
  }
  return "";
}

/**
 * True when a paragraph's hast children are exactly one image (ignoring
 * whitespace-only text nodes). Markdown wraps standalone images in a `<p>`,
 * but our img handler renders block-level content (figure / div / placeholder)
 * which is invalid inside a paragraph and breaks layout. Detect that case so
 * the `p` handler can render the children without the `<p>` wrapper.
 */
function isLoneImageParagraph(node: unknown): boolean {
  if (node === null || typeof node !== "object") return false;
  const children = (node as { children?: unknown[] }).children;
  if (!Array.isArray(children)) return false;
  let imgCount = 0;
  for (const child of children) {
    if (child === null || typeof child !== "object") return false;
    const c = child as { type?: string; tagName?: string; value?: string };
    if (c.type === "text" && typeof c.value === "string" && c.value.trim() === "") continue;
    if (c.type === "element" && c.tagName === "img") {
      imgCount++;
      continue;
    }
    return false;
  }
  return imgCount === 1;
}

function makeDefaultComponents(ctx: LinkContext): Partial<Components> {
  const { onNavigate, basePath, boxSlug } = ctx;
  return {
    p({ children, node }) {
      if (isLoneImageParagraph(node)) {
        return children;
      }
      return <p>{children}</p>;
    },
    img({ src, alt, node: _node }) {
      const resolved = typeof src === "string" ? resolveImageSrc(src, { boxSlug, basePath }) : "";
      return (
        <Image
          src={resolved}
          alt={alt ?? ""}
          size="chat"
          lightbox
          className="block mx-auto my-2"
        />
      );
    },
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
              const label = flattenText(children).trim();
              onNavigate(target, label ? { label } : undefined);
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
              const label = flattenText(children).trim();
              onNavigate(target, label ? { label } : undefined);
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
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
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
      rehypePlugins={rehypePlugins}
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
