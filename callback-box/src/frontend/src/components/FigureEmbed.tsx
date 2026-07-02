/**
 * Inline card/file embeds in markdown.
 *
 * `![alt](store/figures/Foo.figure.card?p=v)` renders the target inline via its
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
import { isExternalUrl, resolveContentTarget } from "../lib/view-url";
import { isImagePath } from "./chat/message-parsing";
import { FileView } from "./FileView";
import { makeImg, type LinkContext, type MarkdownComponentOverrides } from "./Markdown";

const cast = <T,>(c: T) => c as unknown as ComponentType<Record<string, unknown>>;

/**
 * Markdown component overrides that inline card/file embeds. Pass to
 * `<Markdown components={makeEmbedComponents(ctx)}>`.
 */
export function makeEmbedComponents(ctx: LinkContext): MarkdownComponentOverrides {
  const DefaultImg = makeImg(ctx);
  const { onNavigate } = ctx;
  function Img({ src, alt, title }: { src?: string; alt?: string; title?: string }) {
    // An in-box, non-image path embeds the card/file inline via its own viewer.
    // Images and external URLs are ordinary markdown images.
    if (typeof src === "string" && src !== "" && !isExternalUrl(src) && !isImagePath(src)) {
      const target = resolveContentTarget(ctx.basePath, src);
      return (
        <figure className="my-4">
          <FileView
            path={target.path}
            mode="embed"
            rendererName={target.viewer}
            onNavigate={onNavigate}
            params={target.params}
          />
          {alt !== undefined && alt !== "" ? (
            <figcaption className="text-xs text-warm-500 mt-1 text-center">{alt}</figcaption>
          ) : null}
        </figure>
      );
    }
    return <DefaultImg src={src} alt={alt} title={title} />;
  }
  return { Img: cast(Img) };
}
