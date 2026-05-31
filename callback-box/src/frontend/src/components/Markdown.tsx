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
import Markdoc, { type Config, type RenderableTreeNode } from "@markdoc/markdoc";
import { markdocConfig, makeHeadingNode } from "@shared/markdoc-config";
import { makeQuoteComponents } from "./Quote";
import { makeSourceComponents } from "./Source";
import { makeBriefingComponents } from "./BriefingTags";
import { makeRecipeComponents } from "./RecipeTags";
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
import { withBase } from "../api";
import type { ReactNode } from "react";

// Value named imports (`{ parse, … }`) don't resolve from this CommonJS module
// under Node's ESM loader (used by `cb render` SSR); Vite tolerates them but the
// SSR path does not. Destructure off the default import — same pattern and lint
// exception as `markdoc-config.ts` / `body-refs.ts`.
// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM SSR; default-member access is the runtime-correct form for this CJS module
const { parse, transform, renderers } = Markdoc;

interface LinkContext {
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  basePath: string | undefined;
  boxSlug: string | undefined;
}

function viewHref(boxSlug: string | undefined, target: ViewTarget): string {
  return withBase(`/${boxSlug ?? ""}/views/${serializeViewUrl(target)}`);
}

function flattenText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (typeof node === "object") {
    const maybe = node as { props?: { children?: ReactNode } };
    if (maybe.props && "children" in maybe.props) return flattenText(maybe.props.children);
  }
  return "";
}

/**
 * Render a markdown link. View URLs and relative paths are intercepted
 * and handed to the caller's `onNavigate`; everything else opens as a
 * normal external link in a new tab. Empty/non-string hrefs render as
 * a plain anchor (defensive against malformed input).
 */
function makeLink(ctx: LinkContext): React.ComponentType<{ href?: string; title?: string; children?: ReactNode }> {
  return function Link({ href, title, children }) {
    if (typeof href !== "string" || href === "") {
      return <a title={title}>{children}</a>;
    }
    const classified = classifyMarkdownHref(href);
    if (classified.kind === "view") {
      const target = parseViewUrl(classified.raw);
      const resolved = viewHref(ctx.boxSlug, target);
      return (
        <a
          href={resolved}
          title={title}
          onClick={(e) => {
            if (e.defaultPrevented) return;
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            const label = flattenText(children).trim();
            ctx.onNavigate(target, label ? { label } : undefined);
          }}
        >
          {children}
        </a>
      );
    }
    if (classified.kind === "relative") {
      const resolved = resolveRelativePath(ctx.basePath, classified.path);
      const target: ViewTarget = { path: resolved, viewer: null, params: {}, zoom: false };
      const resolvedHref = viewHref(ctx.boxSlug, target);
      return (
        <a
          href={resolvedHref}
          title={title}
          onClick={(e) => {
            if (e.defaultPrevented) return;
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            const label = flattenText(children).trim();
            ctx.onNavigate(target, label ? { label } : undefined);
          }}
        >
          {children}
        </a>
      );
    }
    const isExternal = href.startsWith("http://") || href.startsWith("https://");
    if (isExternal) {
      return (
        <a href={href} title={title} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    }
    return <a href={href} title={title}>{children}</a>;
  };
}

function makeImg(ctx: LinkContext): React.ComponentType<{ src?: string; alt?: string; title?: string }> {
  return function Img({ src, alt, title }) {
    const resolved = typeof src === "string" ? resolveImageSrc(src, { boxSlug: ctx.boxSlug, basePath: ctx.basePath }) : "";
    return (
      <Image
        src={resolved}
        alt={alt ?? ""}
        size="chat"
        lightbox
        className="block mx-auto my-2"
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
function isLoneImageReactChildren(children: ReactNode): boolean {
  const arr = React.Children.toArray(children);
  let imgCount = 0;
  for (const child of arr) {
    if (typeof child === "string" && child.trim() === "") continue;
    if (typeof child === "object" && child !== null && "type" in child) {
      const el = child as React.ReactElement;
      const t = el.type as { displayName?: string; name?: string };
      const name = t.displayName ?? t.name ?? "";
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
    return children as React.ReactElement;
  }
  // A <div>, not a <p>: paragraphs routinely wrap block-level content here
  // (inline file previews, figures, our custom tags), which is invalid inside
  // <p> and triggers React DOM-nesting warnings. `.cb-paragraph` (index.css)
  // restores the prose paragraph spacing.
  return <div className="cb-paragraph">{children}</div>;
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
  const { SourceInline, SourceBlock } = makeSourceComponents({ onNavigate: linkCtx.onNavigate });
  const briefing = makeBriefingComponents({ onNavigate: linkCtx.onNavigate });
  const recipe = makeRecipeComponents({ onNavigate: linkCtx.onNavigate });
  const Task = ({ done }: { done?: boolean }) => (
    <input
      type="checkbox"
      checked={done === true}
      disabled
      readOnly
      className="mr-2 align-middle accent-warm-500"
    />
  );
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
    KeyPerson: cast(briefing.KeyPerson),
    Correction: cast(briefing.Correction),
    Property: cast(briefing.Property),
    ProjectPhase: cast(briefing.ProjectPhase),
    IngredientInline: cast(recipe.IngredientInline),
    IngredientBlock: cast(recipe.IngredientBlock),
    Step: cast(recipe.Step),
    RecipeYield: cast(recipe.RecipeYield),
    Substitution: cast(recipe.Substitution),
    Subrecipe: cast(recipe.Subrecipe),
    RecipeSection: cast(recipe.RecipeSection),
    Task: cast(Task),
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
}

export function Markdown({
  children,
  components,
  prose,
  onNavigate,
  basePath,
}: MarkdownProps) {
  prose = prose ?? false;
  const { boxSlug } = useParams({ strict: false });
  const { tree, mergedComponents } = useMemo(() => {
    const ctx: LinkContext = { onNavigate, basePath, boxSlug };
    const { config, components: defaults } = buildRenderConfig(ctx);
    const ast = parse(children);
    const t: RenderableTreeNode = transform(ast, config);
    const merged = components === undefined ? defaults : { ...defaults, ...components };
    return { tree: t, mergedComponents: merged };
  }, [children, onNavigate, basePath, boxSlug, components]);

  const rendered = renderers.react(tree, React, {
    components: mergedComponents as Record<string, React.ComponentType<Record<string, unknown>>>,
  });

  if (prose === "block") {
    return <div className="prose prose-sm max-w-none text-warm-700">{rendered}</div>;
  }
  if (prose === "inline") {
    return <span className="prose prose-sm inline max-w-none">{rendered}</span>;
  }
  return rendered as React.ReactElement;
}
