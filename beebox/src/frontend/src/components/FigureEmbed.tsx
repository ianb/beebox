/**
 * Inline card/file embeds in markdown.
 *
 * `![alt](_content/figures/Foo.figure.card?p=v)` renders the target inline via its
 * own viewer — the native `!` embed syntax, distinct from a plain `[label](…)`
 * link, which opens the target in the surrounding surface. Query params pass
 * through to the renderer (e.g. figure params). Any in-box, non-image path
 * embeds; real images and external URLs fall back to the default markdown image.
 *
 * This lives outside Markdown.tsx because it imports FileView, which would form
 * a value-import cycle if pulled into that low-level renderer. A card view opts
 * in by passing these overrides to `<Markdown components={…}>`.
 */

import type { ComponentType } from "react";
import { resolveContentTarget } from "../lib/view-url";
import { isUrlRef } from "@shared/ref-path/core";
import { isImagePath } from "./chat/message-parsing";
import { FileView } from "./FileView/view";
import { Img as DefaultImg, type MarkdownComponentOverrides } from "./Markdown/body";
import { useMarkdownRender } from "../lib/markdown-render";

// Markdoc's `MarkdownComponentOverrides` map wants one homogeneous
// `ComponentType<Record<string,unknown>>`, but `Img` below has its own
// specific, narrower prop type. Markdoc only ever invokes it with the props
// declared for the `image` tag (see Markdown.tsx's `buildRenderConfig`), so
// the real prop shape is guaranteed by that contract, not by this cast.
// eslint-disable-next-line no-restricted-syntax -- widen a specifically-typed component to the shared override-map type; Markdoc only calls it with the props declared for the `image` tag, so the real shape is guaranteed by that contract, not by this cast
const cast = <T,>(c: T) => c as unknown as ComponentType<Record<string, unknown>>;

/**
 * The embed. Named `Img`, the name Markdown's `Para` looks for, so a
 * standalone `![](…)` gets no paragraph wrapper. Declared once, so a host
 * re-render reconciles the embed in place and keeps its state.
 *
 * `data-card-embed` marks the embed's boundary for the host: the host card's
 * contents menu ignores DOM changes inside it (a figure redrawing).
 */
function Img({ src, alt, title, width }: { src?: string; alt?: string; title?: string; width?: string }) {
  const { onNavigate, basePath } = useMarkdownRender();
  // An in-box, non-image path embeds the card/file inline via its own viewer.
  // Images and external URLs are ordinary markdown images.
  // A `null` target is an embed path that escapes the box root; it falls
  // through to `DefaultImg`, whose `resolveImageSrc` yields an empty src —
  // a visibly broken image instead of a silently substituted card.
  const target =
    typeof src === "string" && src !== "" && !isUrlRef(src) && !isImagePath(src)
      ? resolveContentTarget(basePath, src)
      : null;
  if (target !== null) {
    // Frameless embed: the renderer owns its own appearance and the caption
    // (a media renderer shows it beneath, so an image card reads like a plain
    // captioned image). No `<figure>`/header wrapper here.
    return (
      <div data-card-embed="" className="contents">
        <FileView
          path={target.path}
          mode="embed"
          rendererName={target.viewer}
          viewState={target.viewState}
          onNavigate={onNavigate}
          params={target.params}
          {...(alt !== undefined && alt !== "" ? { caption: alt } : {})}
        />
      </div>
    );
  }
  return <DefaultImg src={src} alt={alt} title={title} width={width} />;
}

/** Markdown component overrides that inline card/file embeds: `<Markdown components={CARD_EMBED_COMPONENTS}>`. */
export const CARD_EMBED_COMPONENTS: MarkdownComponentOverrides = { Img: cast(Img) };
