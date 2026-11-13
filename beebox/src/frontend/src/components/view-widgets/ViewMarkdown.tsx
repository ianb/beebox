/**
 * <Markdown> for box views — the app's own renderer, exported from
 * `beebox/view-widgets` as `Markdown`.
 *
 * A box view renders card text with this and nothing else (the view check,
 * `core/views/markdown-check.ts`, rejects the alternatives), so a card's
 * Markdoc tags, refs, images, and todos look and work the same in a box view
 * as on the card's own page. `card` gives relative refs their base and gives
 * todos their card path and file lines, so they are tickable where the view
 * sits under a card view's todo actions (`FileView`).
 *
 * An image-syntax embed of a card, `![Hydrogen](/_content/figures/Atom.figure.card?element=H)`,
 * renders that card inline, with the alt text as its caption, as on a card's
 * own page (`FigureEmbed`). The view host renders it (`renderInline`), so this
 * file never imports FileView; `bbx view check` shows a placeholder. Images
 * and external URLs stay ordinary images. A `components.Img` from the caller
 * replaces the embed.
 *
 * Navigation goes through the view host's `openCard`, as `CardLink` does, so
 * a link opens in whatever surface shows the view (and does nothing in
 * `bbx view check`).
 */

import { useCallback, useMemo, type ComponentType } from "react";
import type { Schema } from "@markdoc/markdoc";
import { Markdown, type MarkdownComponentOverrides } from "../Markdown/body";
import { Img as DefaultImg } from "../Markdown/body";
import { useViewHost } from "../../lib/view-host";
import { embedTarget } from "../../lib/card-embed";
import { useMarkdownRender } from "../../lib/markdown-render";
import { useWatchedContent } from "../../lib/runtime-lint/watched-content";
import { serializeViewUrl, type NavigateHint, type ViewTarget } from "../../lib/view-url";

export interface ViewMarkdownProps {
  /** The Markdown text: a card's `body`. */
  children: string;
  /** The card the text is the body of (a `ViewCard` has both fields). */
  card: { path: string; bodyLineOffset: number };
  /** The type's scoped tags (`CardSchemaConfig.markdocTags`), rendered as components via `components`. */
  tags?: Readonly<Record<string, Schema>>;
  /** Component overrides by the name a tag's transform emits. */
  components?: MarkdownComponentOverrides;
}

/**
 * The embed. Named `Img`, the name Markdown's `Para` looks for, so a
 * standalone `![](…)` gets no paragraph wrapper. `data-card-embed` marks the
 * embed's boundary for the host card's contents menu.
 */
function Img({ src, alt, title, width }: { src?: string; alt?: string; title?: string; width?: string }) {
  const { basePath } = useMarkdownRender();
  const { renderInline } = useViewHost();
  const target = embedTarget(basePath, src);
  // Runtime lint: an embed must stay mounted while the view around it is open.
  useWatchedContent("card-embed", target?.path ?? null);
  if (target === null) return <DefaultImg src={src} alt={alt} title={title} width={width} />;
  return (
    <div data-card-embed="" className="contents">
      {renderInline(`/${serializeViewUrl(target)}`, alt !== undefined && alt !== "" ? { caption: alt } : undefined)}
    </div>
  );
}

// Markdown's override map wants one homogeneous component type; `Img` is only
// ever called with the props declared for the `image` tag (see Markdown's
// `buildRenderConfig`), which is where its narrower prop type comes from.
// eslint-disable-next-line no-restricted-syntax -- widen a specifically-typed component to the shared override-map type; Markdoc only calls it with the props declared for the `image` tag
const EMBED_IMG = Img as unknown as ComponentType<Record<string, unknown>>;

export function ViewMarkdown({ children, card, tags, components }: ViewMarkdownProps) {
  const { openCard } = useViewHost();
  // Markdown hands over a resolved, box-rooted target; `openCard` takes a
  // ref, so the target goes back as a box-absolute ref with its query.
  const onNavigate = useCallback((target: ViewTarget, hint?: NavigateHint) => {
    openCard(`/${serializeViewUrl(target)}`, hint?.label === undefined ? undefined : { label: hint.label });
  }, [openCard]);
  const merged = useMemo<MarkdownComponentOverrides>(() => ({ Img: EMBED_IMG, ...components }), [components]);
  return (
    <Markdown prose="block" onNavigate={onNavigate} basePath={card.path} card={card} tags={tags} components={merged}>
      {children}
    </Markdown>
  );
}
