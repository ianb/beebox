/**
 * Markdown + image rendering for chat content: image-only paragraph
 * detection, chat-flavored markdown component overrides, and the
 * prose-styled MarkdownContent wrapper.
 */

import { useCallback, useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { Markdown, type MarkdownComponentOverrides } from "../Markdown";
import { Image } from "../ui/Image";
import { VideoEmbed } from "../ui/VideoEmbed";
import { detectVideoEmbed } from "../../lib/video-url";
import { FileView } from "../FileView";
import { externalImageProxyUrl, isExternalUrl, resolveContentTarget, resolveImageSrc, type NavigateHint, type ViewTarget } from "../../lib/view-url";
import { useBustedImageSrc } from "../../lib/file-version";
import { stripStructuredOutputTags } from "../../lib/structured-output-parsing";
import { isImagePath, stripSpeechTags } from "./message-parsing";
import { useChatContextDir } from "./chat-context-dir";

export type OnZoomView = (view: { target: ViewTarget; label: string }) => void;

/**
 * Markdown image with chat-friendly sizing and lightbox behavior.
 * Used directly for inline images and re-used by image-only paragraphs.
 */
function ChatInlineImage({ src, alt }: { src: string; alt: string }) {
  const bustedSrc = useBustedImageSrc(src);
  const { boxSlug } = useParams({ strict: false });
  const proxyFallbackSrc = externalImageProxyUrl(src, boxSlug);
  return (
    <Image
      src={bustedSrc}
      alt={alt}
      size="chat"
      lightbox
      className="block mx-auto my-2"
      {...(proxyFallbackSrc !== undefined ? { proxyFallbackSrc } : {})}
    />
  );
}

function ChatImage({ src, alt }: { src: string; alt: string }) {
  const hasCaption = alt.trim() !== "";
  const bustedSrc = useBustedImageSrc(src);
  const { boxSlug } = useParams({ strict: false });
  const proxyFallbackSrc = externalImageProxyUrl(src, boxSlug);
  return (
    <Image
      src={bustedSrc}
      alt={alt}
      size="chat"
      lightbox
      caption={hasCaption ? alt : undefined}
      className="mx-auto"
      {...(proxyFallbackSrc !== undefined ? { proxyFallbackSrc } : {})}
    />
  );
}

/**
 * Extract image elements from a paragraph's children.
 * Returns the list of {src, alt} if ALL children are images (or whitespace text),
 * or null if the paragraph has non-image content.
 */
function extractImages(children: React.ReactNode): Array<{ src: string; alt: string }> | null {
  const images: Array<{ src: string; alt: string }> = [];
  const childArray = Array.isArray(children) ? children : [children];

  for (const child of childArray) {
    if (typeof child === "string" && child.trim() === "") continue;
    if (
      child !== null &&
      typeof child === "object" &&
      "type" in child &&
      (child.type === "img" || child.type === ChatInlineImage) &&
      child.props
    ) {
      images.push({ src: child.props.src || "", alt: child.props.alt || "" });
      continue;
    }
    return null;
  }

  return images.length > 0 ? images : null;
}

/**
 * Paragraph override that detects image-only paragraphs and renders them
 * as centered thumbnails (single) or a grid (multiple). The image-only
 * case covers both markdown image syntax (`![](…)`) and `view:` links to
 * image files, because the shared `Link` component for those renders a
 * `ChatInlineImage` — so they show up as rendered children we can detect.
 */
function ChatParagraph({ children }: { children?: React.ReactNode }) {
  const images = extractImages(children);

  if (images) {
    const [only] = images;
    if (images.length === 1 && only !== undefined) {
      return (
        <div className="flex justify-center my-2">
          <ChatImage src={only.src} alt={only.alt} />
        </div>
      );
    }
    return (
      <div className="grid grid-cols-2 gap-2 my-2 justify-items-center">
        {images.map((img, i) => (
          <ChatImage key={i} src={img.src} alt={img.alt} />
        ))}
      </div>
    );
  }

  // A <div>, not a <p>: chat markdown links can expand to block-level file
  // previews, invalid inside <p>. `.cb-paragraph` (index.css) restores spacing.
  return <div className="cb-paragraph">{children}</div>;
}

function makeChatMarkdownComponents(
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void,
  { boxSlug, contextDir }: { boxSlug: string | undefined; contextDir: string | undefined },
): MarkdownComponentOverrides {
  // `![…](…)` is the embed syntax. An image src embeds an image (chat sizing +
  // lightbox); any other in-box path embeds that card/file inline (frameless)
  // via its own viewer.
  function ChatImg({ src, alt }: { src?: string; alt?: string }) {
    const video = src ? detectVideoEmbed(src) : null;
    if (video !== null) {
      return <VideoEmbed embedUrl={video.embedUrl} title={alt || ""} className="mx-auto" />;
    }
    if (!src) return <ChatInlineImage src="" alt={alt || ""} />;
    if (!isExternalUrl(src) && !isImagePath(src)) {
      const target = resolveContentTarget(contextDir, src);
      // Frameless embed (no chat header/border): the renderer owns its
      // appearance and the caption, so an embedded image card reads like a
      // plain captioned image. To open a card in the sidebar, use a link.
      return (
        <FileView
          path={target.path}
          mode="embed"
          rendererName={target.viewer}
          onNavigate={onNavigate}
          params={target.params}
          {...(alt !== undefined && alt !== "" ? { caption: alt } : {})}
        />
      );
    }
    const resolved = resolveImageSrc(src, { boxSlug, basePath: contextDir });
    return <ChatInlineImage src={resolved} alt={alt || ""} />;
  }
  // No `Link` override: the shared `makeLink` (with basePath=contextDir and
  // onNavigate wired to the companion pane) already renders a plain-path link
  // that opens in the sidebar on click, an external link, and the retired-`view:`
  // legacy marker.
  return {
    Para: castMarkdownComponent(ChatParagraph),
    Img: castMarkdownComponent(ChatImg),
  };
}

/**
 * Markdoc's component map is keyed by name with a uniform, untyped props
 * shape; each override here has its own specific props. Narrowing the map to
 * each component's real prop type isn't possible without losing the uniform
 * map shape Markdoc expects, so this single named helper carries the cast —
 * mirrors the same-shaped `cast` helper in `../Markdown.tsx`.
 */
function castMarkdownComponent<P extends object>(
  component: React.ComponentType<P>,
): React.ComponentType<Record<string, unknown>> {
  // eslint-disable-next-line no-restricted-syntax -- Markdoc's component map requires a uniform `ComponentType<Record<string, unknown>>` signature; each override's real props are narrower, and this is the one place that crosses that boundary.
  return component as unknown as React.ComponentType<Record<string, unknown>>;
}

/**
 * Render markdown content with prose styling. Relative link/embed paths resolve
 * against the chat's working directory (from `useChatContextDir`); box-root-
 * absolute `/…` paths ignore it. It flows in as the shared renderer's `basePath`.
 */
export function MarkdownContent({
  text,
  onZoomView,
}: {
  text: string;
  onZoomView?: OnZoomView;
}) {
  const cleaned = useMemo(
    () => stripStructuredOutputTags(stripSpeechTags(text)),
    [text],
  );
  const contextDir = useChatContextDir();
  // `contextDir` is a *directory*, but `resolveRelativePath` treats its base as a
  // containing file and strips the last segment. A trailing slash makes that
  // strip a no-op, so a bare `foo.card` resolves to `<contextDir>/foo.card`, not
  // its parent. Empty/box-root → undefined (resolve against the box root).
  const basePath = contextDir && contextDir !== "" ? `${contextDir.replace(/\/+$/, "")}/` : undefined;
  const { boxSlug } = useParams({ strict: false });
  const handleNavigate = useCallback(
    (target: ViewTarget) => {
      if (onZoomView) {
        onZoomView({ target, label: target.path });
      }
    },
    [onZoomView],
  );
  const components = useMemo(
    () => makeChatMarkdownComponents(handleNavigate, { boxSlug, contextDir: basePath }),
    [handleNavigate, boxSlug, basePath],
  );

  if (!cleaned) return null;

  return (
    <div className="prose prose-sm max-w-none overflow-hidden">
      <Markdown components={components} onNavigate={handleNavigate} basePath={basePath}>{cleaned}</Markdown>
    </div>
  );
}
