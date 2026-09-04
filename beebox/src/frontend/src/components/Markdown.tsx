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
 *    a fragment. The corresponding React components are built fresh per
 *    render with `view:` / relative-path / lightbox routing baked in.
 *  - The `{% quote %}` tag becomes `QuoteInline` or `QuoteBlock` (see
 *    `markdoc-config.ts` and `Quote.tsx`).
 *
 * Callers can pass `components` to override or extend the map. The most
 * common case is chat, which replaces `Link`, `Img`, and `Para` to render
 * file previews, sized inline images, and lone-image grid layouts.
 */

import { Fragment, useMemo } from "react";
import * as React from "react";
import { useParams } from "@tanstack/react-router";
import { transform, renderers, type Config, type RenderableTreeNode } from "@markdoc/markdoc";
import { markdocConfig, makeHeadingNode } from "@shared/markdoc-config";
import { makeQuoteComponents } from "./Quote";
import { makeSourceComponents } from "./Source";
import { makeBriefingComponents } from "./BriefingTags";
import { makeRecipeComponents } from "./RecipeTags";
import { RedactedInline, RedactedBlock } from "./Redacted";
import { makeTodoComponents } from "./Todo";
import { makeSeeAlsoComponent } from "./SeeAlso";
import { makeLink, type LinkContext } from "./markdown-link";
import { Image } from "./ui/Image";
import { VideoEmbed } from "./ui/VideoEmbed";
import { detectVideoEmbed } from "../lib/video-url";
import {
  externalImageProxyUrl,
  resolveImageSrc,
  resolveRelativePath,
  type NavigateHint,
  type ViewTarget,
} from "../lib/view-url";
import { parseMarkdown } from "../lib/markdoc-parse";
import type { ReactNode } from "react";

// Parsing goes through `parseMarkdown` (linkify-enabled) rather than the raw
// `parse` — see lib/markdoc-parse.ts.

export function makeImg(ctx: LinkContext): React.ComponentType<{ src?: string; alt?: string; title?: string }> {
  return function Img({ src, alt, title }) {
    // A markdown image pointed at a recognized video URL renders an embedded
    // player instead. ID extraction can still fail on a YouTube-looking URL —
    // `detectVideoEmbed` returns null there and we fall through to the image.
    const video = typeof src === "string" ? detectVideoEmbed(src) : null;
    if (video !== null) {
      return <VideoEmbed embedUrl={video.embedUrl} title={alt ?? ""} className="mx-auto" />;
    }
    const resolved = typeof src === "string" ? resolveImageSrc(src, { boxSlug: ctx.boxSlug, basePath: ctx.basePath }) : "";
    const proxyFallbackSrc = externalImageProxyUrl(resolved, ctx.boxSlug);
    return (
      <Image
        src={resolved}
        lightboxSrc={resolved}
        alt={alt ?? ""}
        size="chat"
        lightbox
        className="block mx-auto my-2"
        {...(proxyFallbackSrc !== undefined ? { proxyFallbackSrc } : {})}
        {...(title !== undefined ? { title } : {})}
      />
    );
  };
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

function Para({ children }: { children?: ReactNode }) {
  if (isLoneImageReactChildren(children)) {
    return children;
  }
  // A <div>, not a <p>: paragraphs routinely wrap block-level content here
  // (inline file previews, figures, our custom tags), which is invalid inside
  // <p> and triggers React DOM-nesting warnings. `.bbx-paragraph` (index.css)
  // restores the prose paragraph spacing.
  return <div className="bbx-paragraph">{children}</div>;
}

interface RenderConfigBundle {
  config: Config;
  components: Record<string, React.ComponentType<Record<string, unknown>>>;
}

function buildRenderConfig(linkCtx: LinkContext): RenderConfigBundle {
  const config: Config = {
    ...markdocConfig,
    nodes: {
      ...(markdocConfig.nodes ?? {}),
      document: { render: "Fragment" },
      // Fresh per render config so the duplicate-slug set is scoped to this pass.
      heading: makeHeadingNode(),
      paragraph: { render: "Para", children: ["inline"] },
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
        },
      },
    },
  };
  const Link = makeLink(linkCtx);
  const Img = makeImg(linkCtx);
  const { QuoteInline, QuoteBlock } = makeQuoteComponents({ onNavigate: linkCtx.onNavigate });
  const { SourceInline, SourceBlock } = makeSourceComponents({ onNavigate: linkCtx.onNavigate, basePath: linkCtx.basePath, onJumpToQuote: linkCtx.onJumpToQuote });
  const briefing = makeBriefingComponents();
  const recipe = makeRecipeComponents({ onNavigate: linkCtx.onNavigate });
  const { TodoInline, TodoBlock } = makeTodoComponents();
  const SeeAlso = makeSeeAlsoComponent({ onNavigate: linkCtx.onNavigate, basePath: linkCtx.basePath });
  const Task = ({ done }: { done?: boolean }) => (
    <input
      type="checkbox"
      checked={done === true}
      disabled
      readOnly
      className="mr-2 align-middle accent-warm-500"
    />
  );
  // Capture-session transcript markers. `{% image %}` links to the child
  // image card; `{% silence %}` is a dim gap marker. The `ref` attribute is
  // renamed to `sourceRef` by the Markdoc transform (React reserves `ref`).
  const CaptureImage = ({ sourceRef }: { sourceRef?: string }) => {
    const ref = typeof sourceRef === "string" ? sourceRef : "";
    const label = ref.replace(/^attach\//, "").replace(/\.image\.card$/, "");
    const path = ref === "" ? null : resolveRelativePath(linkCtx.basePath, ref);
    // An unresolvable marker (empty or box-escaping ref) renders as inert text,
    // not a button that silently does nothing when clicked.
    if (path === null) {
      return (
        <span className="mx-0.5 align-middle text-xs text-danger-dark" title={`Unresolvable image ref: ${ref}`}>
          📷 {label === "" ? "image" : label}
        </span>
      );
    }
    return (
      <button
        type="button"
        onClick={() => {
          const target: ViewTarget = { path, viewer: null, params: {}, viewState: null };
          linkCtx.onNavigate(target, label === "" ? undefined : { label });
        }}
        className="mx-0.5 rounded bg-warm-100 px-1.5 py-0.5 align-middle text-xs text-warm-700 hover:bg-warm-200"
      >
        📷 {label === "" ? "image" : label}
      </button>
    );
  };
  const Silence = ({ duration }: { duration?: string }) => (
    <span className="mx-1 align-middle text-xs text-warm-400">
      — {typeof duration === "string" ? duration : ""} silence —
    </span>
  );
  // Markdoc's renderer wants one homogeneous `Record<string, ComponentType<Record<string,unknown>>>`
  // map, but each of these components has its own specific, narrower prop type
  // (Link's {href,title,children}, Img's {src,alt,title}, etc). Markdoc only ever
  // invokes a component with the props declared for its tag in `buildRenderConfig`
  // above, so the real prop shape is guaranteed by that contract, not by this
  // widening cast — centralizing it here (rather than at each call site) is the
  // code-style.md-blessed pattern for this exact situation.
  // eslint-disable-next-line no-restricted-syntax -- widen a specifically-typed component to the shared map type; Markdoc only calls it with the props declared for its tag, so the real shape is guaranteed by the tag config above, not by this cast
  const cast = <T,>(c: T) => c as unknown as React.ComponentType<Record<string, unknown>>;
  const components: Record<string, React.ComponentType<Record<string, unknown>>> = {
    Fragment: cast(Fragment),
    Para: cast(Para),
    Link: cast(Link),
    Img: cast(Img),
    QuoteInline: cast(QuoteInline),
    QuoteBlock: cast(QuoteBlock),
    SourceInline: cast(SourceInline),
    SourceBlock: cast(SourceBlock),
    Purpose: cast(briefing.Purpose),
    Correction: cast(briefing.Correction),
    IngredientInline: cast(recipe.IngredientInline),
    IngredientBlock: cast(recipe.IngredientBlock),
    Step: cast(recipe.Step),
    RecipeYield: cast(recipe.RecipeYield),
    Substitution: cast(recipe.Substitution),
    Subrecipe: cast(recipe.Subrecipe),
    RecipeSection: cast(recipe.RecipeSection),
    Task: cast(Task),
    CaptureImage: cast(CaptureImage),
    Silence: cast(Silence),
    RedactedInline: cast(RedactedInline),
    RedactedBlock: cast(RedactedBlock),
    TodoInline: cast(TodoInline),
    TodoBlock: cast(TodoBlock),
    SeeAlso: cast(SeeAlso),
  };
  return { config, components };
}

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
  prose?: ProseVariant;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  basePath?: string;
  /** See LinkContext.onJumpToQuote — wired by CommentaryView for source chips. */
  onJumpToQuote?: (quoteText: string) => Promise<boolean>;
}

export function Markdown({
  children,
  components,
  prose,
  onNavigate,
  basePath,
  onJumpToQuote,
}: MarkdownProps) {
  prose = prose ?? false;
  const { boxSlug } = useParams({ strict: false });
  const { tree, mergedComponents } = useMemo(() => {
    const ctx: LinkContext = { onNavigate, basePath, boxSlug, onJumpToQuote };
    const { config, components: defaults } = buildRenderConfig(ctx);
    const ast = parseMarkdown(children);
    const t: RenderableTreeNode = transform(ast, config);
    // `components` is `Partial<...>`, so a plain object spread would carry
    // possibly-`undefined` values into the merged map; only copy overrides
    // that are actually set.
    const merged: Record<string, React.ComponentType<Record<string, unknown>>> = { ...defaults };
    for (const [name, override] of Object.entries(components ?? {})) {
      if (override !== undefined) merged[name] = override;
    }
    return { tree: t, mergedComponents: merged };
  }, [children, onNavigate, basePath, boxSlug, components, onJumpToQuote]);

  const rendered = renderers.react(tree, React, {
    components: mergedComponents,
  });

  if (prose === "block") {
    return <div className="prose prose-sm max-w-none text-warm-700">{rendered}</div>;
  }
  if (prose === "inline") {
    return <span className="prose prose-sm inline max-w-none">{rendered}</span>;
  }
  return rendered;
}
