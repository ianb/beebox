/**
 * Inline figure embeds in markdown.
 *
 * `![alt](view:store/figures/Foo.figure.card?p=v)` renders the figure inline —
 * the native "embed media" syntax, distinct from a plain `[label](view:…)`
 * link, which stays a navigable link. Query params pass through to the figure
 * renderer. Real images and non-figure `view:` image srcs fall back to the
 * default markdown image.
 *
 * This lives outside Markdown.tsx because it imports FileView, which would form
 * a value-import cycle if pulled into that low-level renderer. A card view opts
 * in by passing these overrides to `<Markdown components={…}>`.
 */

import type { ComponentType } from "react";
import { parseViewUrl } from "../lib/view-url";
import { FileView } from "./FileView";
import { makeImg, type LinkContext, type MarkdownComponentOverrides } from "./Markdown";

const cast = <T,>(c: T) => c as unknown as ComponentType<Record<string, unknown>>;

function isFigurePath(path: string): boolean {
  return path.endsWith(".figure.card");
}

/**
 * Markdown component overrides that inline figure embeds. Pass to
 * `<Markdown components={makeFigureEmbedComponents(ctx)}>`.
 */
export function makeFigureEmbedComponents(ctx: LinkContext): MarkdownComponentOverrides {
  const DefaultImg = makeImg(ctx);
  const { onNavigate } = ctx;
  function Img({ src, alt, title }: { src?: string; alt?: string; title?: string }) {
    if (typeof src === "string" && src.startsWith("view:")) {
      const target = parseViewUrl(src);
      if (isFigurePath(target.path)) {
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
    }
    return <DefaultImg src={src} alt={alt} title={title} />;
  }
  return { Img: cast(Img) };
}
