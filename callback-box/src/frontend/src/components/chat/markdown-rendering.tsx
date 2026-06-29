/**
 * Markdown + image rendering for chat content: image-only paragraph
 * detection, chat-flavored markdown component overrides, and the
 * prose-styled MarkdownContent wrapper.
 */

import { useCallback, useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { Markdown, type MarkdownComponentOverrides } from "../Markdown";
import { Image } from "../ui/Image";
import { FileView } from "../FileView";
import { externalImageProxyUrl, parseViewUrl, resolveImageSrc, type NavigateHint, type ViewTarget } from "../../lib/view-url";
import { useBustedImageSrc } from "../../lib/file-version";
import { getApiBase } from "../../api";
import { stripStructuredOutputTags } from "../../lib/structured-output-parsing";
import { isImagePath, stripSpeechTags } from "./message-parsing";

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
    if (images.length === 1) {
      return (
        <div className="flex justify-center my-2">
          <ChatImage src={images[0].src} alt={images[0].alt} />
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
  { boxSlug, onZoomView }: { boxSlug: string | undefined; onZoomView?: OnZoomView },
): MarkdownComponentOverrides {
  function ChatImg({ src, alt }: { src?: string; alt?: string }) {
    const resolved = src ? resolveImageSrc(src, { boxSlug, basePath: undefined }) : "";
    return <ChatInlineImage src={resolved} alt={alt || ""} />;
  }
  function ChatLink({ href, children }: { href?: string; children?: React.ReactNode }) {
    if (href && href.startsWith("view:")) {
      const target = parseViewUrl(href);
      if (isImagePath(target.path)) {
        const alt = typeof children === "string" ? children : target.path;
        return <ChatInlineImage src={`${getApiBase()}/files/${target.path}`} alt={alt} />;
      }
      if (target.zoom && onZoomView) {
        const label = typeof children === "string" ? children : target.path;
        return (
          <button
            onClick={() => onZoomView({ target: { ...target, zoom: false }, label })}
            className="text-primary hover:text-primary/80 underline cursor-pointer"
          >
            {children}
          </button>
        );
      }
      const panelLabel = typeof children === "string" ? children : target.path;
      return (
        <FileView
          path={target.path}
          mode="chat"
          rendererName={target.viewer}
          onNavigate={onNavigate}
          params={target.params}
          {...(onZoomView
            ? { onOpenInPanel: () => onZoomView({ target: { ...target, zoom: false }, label: panelLabel }) }
            : {})}
        />
      );
    }
    const isExternal = typeof href === "string" && (href.startsWith("http://") || href.startsWith("https://"));
    if (isExternal) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
          <ExternalLinkIndicator />
        </a>
      );
    }
    return <a href={href}>{children}</a>;
  }
  return {
    Para: ChatParagraph as React.ComponentType<Record<string, unknown>>,
    Img: ChatImg as React.ComponentType<Record<string, unknown>>,
    Link: ChatLink as React.ComponentType<Record<string, unknown>>,
  };
}

function ExternalLinkIndicator() {
  return (
    <svg
      className="inline-block w-[0.85em] h-[0.85em] ml-0.5 align-[-0.1em] opacity-70"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" />
    </svg>
  );
}

/**
 * Render markdown content with prose styling.
 */
export function MarkdownContent({ text, onZoomView }: { text: string; onZoomView?: OnZoomView }) {
  const cleaned = useMemo(
    () => stripStructuredOutputTags(stripSpeechTags(text)),
    [text],
  );
  const { boxSlug } = useParams({ strict: false });
  const handleNavigate = useCallback(
    (target: ViewTarget) => {
      if (onZoomView) {
        onZoomView({ target: { ...target, zoom: false }, label: target.path });
      }
    },
    [onZoomView],
  );
  const components = useMemo(
    () => makeChatMarkdownComponents(handleNavigate, { boxSlug, onZoomView }),
    [handleNavigate, boxSlug, onZoomView],
  );

  if (!cleaned) return null;

  return (
    <div className="prose prose-sm max-w-none overflow-hidden">
      <Markdown components={components} onNavigate={handleNavigate}>{cleaned}</Markdown>
    </div>
  );
}
