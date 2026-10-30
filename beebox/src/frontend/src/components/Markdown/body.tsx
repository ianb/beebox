/**
 * Shared Markdown renderer, backed by Markdoc.
 *
 * Markdoc replaces the previous react-markdown + remark/rehype stack. The
 * pipeline is:
 *   parse  → Markdoc.parse(source)
 *   transform → Markdoc.transform(ast, markdocConfig + per-call link/image
 *               renderable overrides)
 *   render  → Markdoc.renderers.react(tree, React, { components })
 *
 * What lands in the renderable tree:
 *  - Built-in node renders are configured so links become `Link`, images
 *    become `Img`, paragraphs become `Para`, and the document root becomes
 *    a fragment.
 *  - The `{% quote %}` tag becomes `QuoteInline` or `QuoteBlock` (see
 *    `markdoc-config.ts` and `Quote.tsx`).
 *  - A fenced code block becomes `Fence`: the block plus a Copy button.
 *
 * Callers can pass `components` to override or extend the map. The most
 * common case is chat, which replaces `Img` and `Para` to render embeds,
 * sized inline images, and lone-image grid layouts.
 *
 * Every component in the map, and in a caller's override map, is declared
 * once at module scope and reads per-render values (`onNavigate`, `basePath`,
 * …) from `MarkdownRenderContext` (`lib/markdown-render.ts`). A component made per
 * render is a new React type: React remounts it, an embedded figure loses its
 * state, and the reader's place moves. So a new callback or edited text
 * updates the body in place. `bin/card-remount-check` shows the symptom in a
 * real browser; `body.stable-body.test.ts` holds the rule.
 */

import { Fragment, useMemo, useRef } from "react";
import * as React from "react";
import Markdoc, { type Config, type Schema } from "@markdoc/markdoc";
import { makeHeadingNode } from "@shared/markdoc-config/tags/core";
import { withScopedTags, rewriteUnknownTags } from "@shared/markdoc-config/scoped";
import { UnknownTagInline, UnknownTagBlock } from "./UnknownTag";
import { makeHtmlTag } from "@shared/markdoc-config/tags/html-schema";
import { QuoteInline, QuoteBlock } from "./Quote";
import { SourceInline, SourceBlock } from "./Source";
import { RedactedInline, RedactedBlock } from "./Redacted";
import { TodoInline, TodoBlock } from "./Todo";
import { SeeAlso } from "./SeeAlso";
import { IncludeFile } from "./IncludeFile";
import { MarkdownRenderContext, useMarkdownRender, type MarkdownRender } from "../../lib/markdown-render";
import { isInstructionFile, rewriteIncludeLines } from "../../lib/include-lines";
import { assignLocators, stampLocators } from "@shared/todo-locators";
import { Link } from "../markdown-link/link";
import { useOptionalLightbox } from "../LightboxProvider";
import { Button } from "../ui/Button";
import { Image } from "../ui/Image/view";
import { VideoEmbed } from "../ui/VideoEmbed";
import { detectVideoEmbed } from "../../lib/video-url";
import {
  externalImageProxyUrl,
  resolveImageSrc,
  type NavigateHint,
  type ViewTarget,
} from "../../lib/view-url";
import { parseMarkdown } from "../../lib/markdoc-parse";
import { useBoxSlug } from "../../lib/box-slug";
import { transformedResolvedImageUrl } from "../../lib/image-transform-url";
import type { ReactNode } from "react";

// Named value imports don't resolve from this CommonJS module under Node's ESM loader.
// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
const { transform, renderers, Tag, nodes: markdocNodes } = Markdoc;

// Parsing goes through `parseMarkdown` (linkify-enabled) rather than the raw
// `parse` — see lib/markdoc-parse.ts.

export function Img({ src, alt, title, width }: { src?: string; alt?: string; title?: string; width?: string }): ReactNode {
  const ctx = useMarkdownRender();
  // A markdown image pointed at a recognized video URL renders an embedded
  // player instead. ID extraction can still fail on a YouTube-looking URL —
  // `detectVideoEmbed` returns null there and we fall through to the image.
  const video = typeof src === "string" ? detectVideoEmbed(src) : null;
  if (video !== null) {
    return <VideoEmbed embedUrl={video.embedUrl} title={alt ?? ""} className="mx-auto" />;
  }
  const resolved = typeof src === "string" ? resolveImageSrc(src, { boxSlug: ctx.boxSlug, basePath: ctx.basePath }) : "";
  const displaySrc = transformedResolvedImageUrl(resolved, {
    width: 960,
    fit: "scale-down",
    quality: 85,
    format: "auto",
  }) ?? resolved;
  const proxyFallbackSrc = externalImageProxyUrl(resolved, ctx.boxSlug);
  const image = (
    <Image
      src={displaySrc}
      lightboxSrc={resolved}
      alt={alt ?? ""}
      size="chat"
      lightbox
      className={width === undefined ? "block mx-auto my-2" : "block w-full my-2"}
      {...(proxyFallbackSrc !== undefined ? { proxyFallbackSrc } : {})}
      {...(title !== undefined ? { title } : {})}
    />
  );
  if (width === undefined) return image;
  // An HTML `<img width>` (the only way to size an image in a body): pixels
  // or a percentage of the column, never wider than the column.
  return (
    <span className="block mx-auto max-w-full" style={{ width: width.endsWith("%") ? width : `${width}px` }}>
      {image}
    </span>
  );
}

/**
 * Default paragraph. A paragraph that contains only a single image gets
 * its `<p>` wrapper dropped — our `Img` component renders block-level
 * content (figure / lightbox), which is invalid inside a `<p>` and breaks
 * layout. Detect that case and unwrap.
 */
/**
 * Best-effort debug name for a JSX element's `type`. `displayName` is a common
 * but non-required convention that `JSXElementConstructor` doesn't declare, so
 * reading it needs an assertion — isolated here rather than at the call site.
 */
function componentDisplayName(type: string | React.JSXElementConstructor<unknown>): string {
  if (typeof type === "string") return type;
  // eslint-disable-next-line no-restricted-syntax -- displayName is a convention, not part of JSXElementConstructor's type; reading it off an arbitrary component reference for this debug-name heuristic can't be done without an assertion
  return (type as { displayName?: string }).displayName ?? type.name;
}

function isLoneImageReactChildren(children: ReactNode): boolean {
  const arr = React.Children.toArray(children);
  let imgCount = 0;
  for (const child of arr) {
    if (typeof child === "string" && child.trim() === "") continue;
    if (React.isValidElement(child)) {
      const name = componentDisplayName(child.type);
      if (name === "Img" || name === "Image") {
        imgCount++;
        continue;
      }
    }
    return false;
  }
  return imgCount === 1;
}

const PARA_ALIGN_CLASSES: Record<string, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
  justify: "text-justify",
};

/** `align`, `title`, `lang` and `dir` arrive only from an HTML `<p>` (see `makeHtmlTag`). */
function Para({ children, align, title, lang, dir }: { children?: ReactNode; align?: string; title?: string; lang?: string; dir?: string }) {
  if (isLoneImageReactChildren(children)) {
    return children;
  }
  // A <div>, not a <p>: paragraphs routinely wrap block-level content here
  // (inline file previews, figures, our custom tags), which is invalid inside
  // <p> and triggers React DOM-nesting warnings. `.bbx-paragraph` (index.css)
  // restores the prose paragraph spacing.
  const alignClass = align === undefined ? undefined : PARA_ALIGN_CLASSES[align];
  return (
    <div className={alignClass === undefined ? "bbx-paragraph" : `bbx-paragraph ${alignClass}`} title={title} lang={lang} dir={dir}>
      {children}
    </div>
  );
}

/**
 * A fenced code block with a Copy button. An agent puts a drafted message in a
 * fence for the person to paste elsewhere; the button copies the block's text
 * as rendered, without selecting by hand. The button floats inside the block
 * so wrapped lines flow around it; the text is read from its own span so the
 * button's label is never copied.
 */
function Fence({ children, "data-language": language }: { children?: ReactNode; "data-language"?: string }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(textRef.current?.textContent ?? "");
  };
  return (
    <pre data-language={language}>
      <Button size="sm" intent="secondary" className="float-right ml-2 mb-1 print:hidden" flash={{ label: "Copied" }} aria-live="polite" onClick={copy}>
        Copy
      </Button>
      <span ref={textRef}>{children}</span>
    </pre>
  );
}

// Render-only: `rewriteIncludeLines` writes it for an instruction file's
// include lines. It is not in the shared tag table, so no agent writes it.
const includeFileTag: Schema = {
  render: "IncludeFile",
  selfClosing: true,
  attributes: { path: { type: String, required: true } },
};

function buildRenderConfig({ tags, includes }: { tags: Readonly<Record<string, Schema>> | undefined; includes: boolean }): Config {
  const base = withScopedTags(tags);
  const config: Config = {
    ...base,
    // An HTML `<p>` renders as `Para`, the same `<div>` a Markdown paragraph gets.
    tags: { ...base.tags, html: makeHtmlTag({ paragraph: "Para" }), ...(includes ? { "include-file": includeFileTag } : {}) },
    nodes: {
      ...base.nodes,
      document: { render: "Fragment" },
      // Fresh per render config so the duplicate-slug set is scoped to this pass.
      heading: makeHeadingNode(),
      paragraph: { render: "Para", children: ["inline"] },
      // Markdoc's own fence transform hardcodes `pre`; this one emits `Fence`.
      fence: {
        ...markdocNodes.fence,
        transform(node, cfg) {
          const children = node.children.length > 0 ? node.transformChildren(cfg) : [node.attributes.content];
          return new Tag("Fence", node.transformAttributes(cfg), children);
        },
      },
      blockquote: { render: "Blockquote", children: ["paragraph", "tag", "blockquote", "list", "heading", "fence"] },
      link: {
        render: "Link",
        children: ["strong", "em", "s", "code", "text", "tag"],
        attributes: {
          href: { type: String },
          title: { type: String },
        },
      },
      image: {
        render: "Img",
        attributes: {
          src: { type: String },
          alt: { type: String },
          title: { type: String },
          width: { type: String },
        },
      },
    },
  };
  return config;
}

function Blockquote({ children }: { children?: ReactNode }) {
  return <blockquote className="bbx-blockquote">{children}</blockquote>;
}

function Task({ done }: { done?: boolean }) {
  return (
    <input
      type="checkbox"
      checked={done === true}
      disabled
      readOnly
      className="mr-2 align-middle accent-warm-500"
    />
  );
}

type MarkdownComponent = React.ComponentType<Record<string, unknown>>;

// Markdoc's renderer wants one homogeneous `Record<string, ComponentType<Record<string,unknown>>>`
// map, but each of these components has its own specific, narrower prop type
// (Link's {href,title,children}, Img's {src,alt,title}, etc). Markdoc only ever
// invokes a component with the props declared for its tag in `buildRenderConfig`
// above, so the real prop shape is guaranteed by that contract, not by this
// widening cast — centralizing it here (rather than at each call site) is the
// code-style.md-blessed pattern for this exact situation.
// eslint-disable-next-line no-restricted-syntax -- widen a specifically-typed component to the shared map type; Markdoc only calls it with the props declared for its tag, so the real shape is guaranteed by the tag config above, not by this cast
const cast = <T,>(c: T) => c as unknown as MarkdownComponent;

/**
 * The component for each name Markdoc emits. Declared once: a component made
 * per render is a new React type, and React would remount it (and an embed's
 * whole subtree) on every render. Per-render values come from
 * `MarkdownRenderContext`.
 */
const MARKDOWN_COMPONENTS: Readonly<Record<string, MarkdownComponent>> = {
  Fragment: cast(Fragment),
  Para: cast(Para),
  Fence: cast(Fence),
  Blockquote: cast(Blockquote),
  Link: cast(Link),
  Img: cast(Img),
  QuoteInline: cast(QuoteInline),
  QuoteBlock: cast(QuoteBlock),
  SourceInline: cast(SourceInline),
  SourceBlock: cast(SourceBlock),
  Task: cast(Task),
  RedactedInline: cast(RedactedInline),
  RedactedBlock: cast(RedactedBlock),
  TodoInline: cast(TodoInline),
  TodoBlock: cast(TodoBlock),
  SeeAlso: cast(SeeAlso),
  IncludeFile: cast(IncludeFile),
  UnknownTagInline: cast(UnknownTagInline),
  UnknownTagBlock: cast(UnknownTagBlock),
};

type ProseVariant = false | "block" | "inline";

export type MarkdownComponentOverrides = Partial<
  Record<string, React.ComponentType<Record<string, unknown>>>
>;

interface MarkdownProps {
  children: string;
  /**
   * Per-call component overrides. Keys are the names Markdoc emits into
   * the renderable tree — `Para`, `Link`, `Img`, `QuoteInline`,
   * `QuoteBlock`, or any custom tag name. Values replace the default
   * component entirely.
   */
  components?: MarkdownComponentOverrides;
  /** A type's scoped tags (`CardSchemaConfig.markdocTags`), merged over the core table for this render. */
  tags?: Readonly<Record<string, Schema>>;
  prose?: ProseVariant;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  basePath?: string;
  /** See MarkdownRender.onJumpToQuote — wired by CommentaryView for source chips. */
  onJumpToQuote?: (quoteText: string) => Promise<boolean>;
  /**
   * The card whose whole body `children` is, and how many file lines precede
   * that body. Given, each `{% todo %}` learns its locator
   * (`shared/todo-locators.ts`) and card path, so it can find its plate state
   * (`todo/card-todos-context.ts`). Omitted for anything that is not a card's
   * body (chat, commit messages, a body excerpt): no locators, no controls.
   */
  card?: { path: string; bodyLineOffset: number };
  /**
   * This Markdown is the card's document, so its headings fill the card's
   * contents menu (`CardContents/CardContentsMenu.tsx`). Needs `prose="block"`.
   */
  outline?: boolean;
}

export function Markdown({
  children,
  components,
  tags,
  prose,
  onNavigate,
  basePath,
  onJumpToQuote,
  card,
  outline,
}: MarkdownProps) {
  prose = prose ?? false;
  const boxSlug = useBoxSlug();
  const cardPath = card?.path ?? null;
  const bodyLineOffset = card?.bodyLineOffset ?? null;
  const openImageLink = useOptionalLightbox()?.openFromElement;
  // The tree depends only on what the transform reads. Callbacks reach the
  // components through the context, so a new `onNavigate` re-renders the body
  // in place rather than remounting it.
  const tree = useMemo(() => {
    const includes = isInstructionFile(basePath);
    const config = buildRenderConfig({ tags, includes });
    const ast = parseMarkdown(includes ? rewriteIncludeLines(children) : children);
    rewriteUnknownTags(ast, config);
    // The collector's own numbering, so a rendered todo and the todo a write
    // addresses cannot disagree about which one `line#2` is.
    if (bodyLineOffset !== null) stampLocators(assignLocators(ast, bodyLineOffset));
    return transform(ast, config);
  }, [children, basePath, tags, bodyLineOffset]);
  // `components` is `Partial<...>`, so a plain object spread would carry
  // possibly-`undefined` values into the merged map; only copy overrides
  // that are actually set. A caller passes a module constant, so this stays put.
  const mergedComponents = useMemo(() => {
    const merged: Record<string, MarkdownComponent> = { ...MARKDOWN_COMPONENTS };
    for (const [name, override] of Object.entries(components ?? {})) {
      if (override !== undefined) merged[name] = override;
    }
    return merged;
  }, [components]);
  const render = useMemo<MarkdownRender>(
    () => ({ onNavigate, basePath, boxSlug, onJumpToQuote, openImageLink, cardPath }),
    [onNavigate, basePath, boxSlug, onJumpToQuote, openImageLink, cardPath],
  );

  const rendered = (
    <MarkdownRenderContext.Provider value={render}>
      {renderers.react(tree, React, { components: mergedComponents })}
    </MarkdownRenderContext.Provider>
  );

  if (prose === "block") {
    return <div className="prose prose-sm max-w-none bbx-theme-prose" data-card-outline={outline === true ? "" : undefined}>{rendered}</div>;
  }
  if (prose === "inline") {
    return <span className="prose prose-sm inline max-w-none bbx-theme-prose">{rendered}</span>;
  }
  return rendered;
}
