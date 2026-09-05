import { useEffect, useReducer, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useLightbox } from "../LightboxProvider";
import { cn } from "../../lib/cn";
import { imageUrlKey } from "../../lib/image-url-key";

const SIZE_CLASSES = {
  thumb: "w-16 h-16 object-cover",
  sm: "max-w-xs max-h-64",
  md: "max-w-full max-h-96",
  // Preserve intrinsic proportions; the scroll controller compensates decode-time reflow.
  chat: "max-w-full max-h-[70vh]",
  lg: "max-w-full max-h-[32rem]",
} as const;

export type ImageSize = keyof typeof SIZE_CLASSES;
export type ImageRotation = 0 | 90 | 180 | 270;

// URLs that have already failed to load this session. Module-scoped, NOT
// component state, on purpose: markdown re-renders its whole tree on every
// keystroke, which can remount an <img> and wipe per-component state. Keying
// the failure here means a remounted Image whose `src` is already known broken
// goes straight to the proxy fallback (or the placeholder once that failed too)
// instead of re-running the error sequence and re-fetching the dead URL.
const failedImageUrls = new Set<string>();

interface LoadStateOpts {
  src: string;
  fallbackSrc: string | undefined;
  locallyFailed: boolean;
}

function getLoadState({ src, fallbackSrc, locallyFailed }: LoadStateOpts) {
  const primaryFailed = locallyFailed || failedImageUrls.has(imageUrlKey(src));
  const fallbackFailed = fallbackSrc !== undefined && failedImageUrls.has(imageUrlKey(fallbackSrc));
  const usingFallback = primaryFailed && fallbackSrc !== undefined && !fallbackFailed;
  return {
    displaySrc: usingFallback ? fallbackSrc : src,
    errored: primaryFailed && (fallbackSrc === undefined || fallbackFailed),
  };
}

interface BaseImageProps {
  src: string;
  srcSet?: string | undefined; sizes?: string | undefined;
  alt: string;
  size?: ImageSize;
  caption?: ReactNode;
  overlay?: ReactNode;
  rotation?: ImageRotation;
  bordered?: boolean;
  title?: string;
  /**
   * Optional alternate URL to retry once if `src` fails to load (e.g. an
   * `/api/proxy-image` URL for an external image whose origin blocks
   * hot-linking). If the fallback also fails, the broken-image placeholder is
   * shown. Omit for in-box images, which have no proxy.
   */
  proxyFallbackSrc?: string;
  /**
   * Outer-layout classes (margin, padding, flex item, sizing, position),
   * applied to whichever element ends up being outermost (figure when
   * `caption` is set, the overlay wrapper when `overlay` is set, otherwise
   * the img itself).
   */
  className?: string;
  /**
   * Native `<img loading>` hint. Omit for the browser default (eager);
   * pass `"lazy"` for offscreen images a page renders many of up front
   * (e.g. a page-render strip) so only the ones near the viewport fetch.
   */
  loading?: "lazy" | "eager";
}

export type ImageProps =
  | (BaseImageProps & { lightbox: true; lightboxSrc: string; onClick?: never })
  | (BaseImageProps & { lightbox?: false; lightboxSrc?: never; onClick?: () => void });

function BrokenImageIcon() {
  return (
    <svg
      className="w-6 h-6"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5v9A2.5 2.5 0 0 0 5.5 19h13a2.5 2.5 0 0 0 2.5-2.5v-9A2.5 2.5 0 0 0 18.5 5h-13A2.5 2.5 0 0 0 3 7.5Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m3 15 4.5-4.5 3 3M14 13l2-2 5 5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m4 4 16 16" />
    </svg>
  );
}

function errorSizeClass(size: ImageSize): string {
  // Keep the failure state compact regardless of the successful image cap.
  return size === "chat" ? SIZE_CLASSES.md : SIZE_CLASSES[size];
}

function ErrorPlaceholder({ alt, size, bordered, extraClass }: { alt: string; size: ImageSize; bordered: boolean; extraClass?: string }) {
  const borderClass = bordered ? "border border-warm-300" : "border border-warm-200";
  return (
    <div
      className={cn(errorSizeClass(size), borderClass, "rounded bg-warm-100 flex flex-col items-center justify-center text-warm-500 text-xs p-2 gap-1", extraClass)}
      role="img"
      aria-label={`Failed to load image: ${alt}`}
    >
      <BrokenImageIcon />
      <div className="text-center break-words max-w-full font-medium">Failed to load</div>
      {alt.trim() !== "" ? (
        <div className="text-center break-words max-w-full opacity-75 text-[10px] leading-tight line-clamp-2">
          {alt}
        </div>
      ) : null}
    </div>
  );
}

interface ImgElementProps {
  src: string;
  srcSet: string | undefined; sizes: string | undefined;
  alt: string;
  size: ImageSize;
  bordered: boolean;
  rotationStyle: CSSProperties | undefined;
  title: string | undefined;
  onActivate: ((element: HTMLImageElement) => void) | null;
  onError: (failedSrc: string) => void;
  onLoad: (element: HTMLImageElement) => void;
  /** Widen the wrapping button to its container — see `stretch` in `Image`. */
  stretch: boolean;
  lightbox: boolean;
  lightboxSrc: string | undefined;
  lightboxCaption: string | undefined;
  imgRef: React.RefObject<HTMLImageElement>;
  extraClass?: string;
  loading: "lazy" | "eager" | undefined;
}

function ImgElement({ src, srcSet, sizes, alt, size, bordered, rotationStyle, title, onActivate, onError, onLoad, stretch, lightbox, lightboxSrc, lightboxCaption, imgRef, extraClass, loading }: ImgElementProps) {
  const interactive = onActivate !== null;
  const handleClick = () => {
    if (onActivate !== null && imgRef.current) onActivate(imgRef.current);
  };

  // `img` is a non-interactive element by ARIA default: it can't legitimately
  // take role="button" (jsx-a11y/no-noninteractive-element-to-interactive-role),
  // and faking click/keydown handlers on it means hand-rolling focus, tabIndex,
  // and Enter/Space activation that a real <button> gets for free. So the
  // interactive case wraps the img in an actual <button> instead of dressing
  // the img up as one.
  const imgNode = (
    <img
      ref={imgRef}
      src={src}
      srcSet={srcSet}
      sizes={sizes}
      alt={alt}
      loading={loading}
      // In the interactive case the button is the outermost element, so
      // context styles that space the image against surrounding flow (e.g.
      // prose typography's vertical img margins) must not land on the img —
      // trapped inside the button they become dead clickable height instead
      // of collapsing into the layout. m-0 suppresses them; the button
      // carries the caller's spacing classes (extraClass) instead.
      className={cn(SIZE_CLASSES[size], "rounded", bordered ? "border border-warm-300" : "", interactive ? "m-0" : extraClass)}
      style={rotationStyle}
      onError={(event) => onError(event.currentTarget.currentSrc || src)}
      onLoad={(event) => onLoad(event.currentTarget)}
      title={title}
      data-image-src={lightbox ? lightboxSrc ?? src : undefined}
      data-image-alt={lightbox ? alt : undefined}
      data-image-caption={lightbox && lightboxCaption !== undefined ? lightboxCaption : undefined}
    />
  );

  if (!interactive) {
    return imgNode;
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={lightbox ? `${alt} (click to zoom)` : undefined}
      className={cn(
        "block border-0 bg-transparent p-0",
        stretch ? "w-full" : "",
        lightbox ? "cursor-zoom-in" : "cursor-pointer",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        extraClass,
      )}
    >
      {imgNode}
    </button>
  );
}

function wrapOrthogonal({ node, extraClass }: { node: ReactNode; extraClass?: string }): ReactNode {
  return (
    <div className={cn("flex items-center justify-center", extraClass)} style={{ padding: "15% 0" }}>
      {node}
    </div>
  );
}

function wrapWithOverlay({ node, overlay, stretch, extraClass }: { node: ReactNode; overlay: ReactNode; stretch: boolean; extraClass?: string }): ReactNode {
  return (
    <div className={cn("relative inline-block", stretch ? "w-full" : "", extraClass)}>
      {node}
      {overlay}
    </div>
  );
}

function wrapInFigure({ node, caption, stretch, extraClass }: { node: ReactNode; caption: ReactNode; stretch: boolean; extraClass?: string }): ReactNode {
  return (
    <figure className={cn("inline-flex flex-col items-center", stretch ? "w-full" : "", extraClass)}>
      {node}
      <figcaption className="mt-1 max-w-full text-xs text-warm-600 italic text-center">
        {caption}
      </figcaption>
    </figure>
  );
}

type OuterLayer = "figure" | "overlay" | "orthogonal" | "img";

interface AssembleOpts {
  base: ReactNode;
  caption: ReactNode;
  overlay: ReactNode;
  errored: boolean;
  isOrthogonal: boolean;
  stretch: boolean;
  outerLayer: OuterLayer;
  className: string | undefined;
}

function assembleImage({ base, caption, overlay, errored, isOrthogonal, stretch, outerLayer, className }: AssembleOpts): ReactNode {
  let node: ReactNode = base;
  if (isOrthogonal && !errored) {
    node = wrapOrthogonal({ node, extraClass: outerLayer === "orthogonal" ? className : undefined });
  }
  if (overlay !== undefined && !errored) {
    node = wrapWithOverlay({ node, overlay, stretch, extraClass: outerLayer === "overlay" ? className : undefined });
  }
  if (caption !== undefined) {
    node = wrapInFigure({ node, caption, stretch, extraClass: className });
  }
  return node;
}

interface OuterLayerOpts {
  caption: ReactNode;
  overlay: ReactNode;
  errored: boolean;
  isOrthogonal: boolean;
}

function pickOuterLayer({ caption, overlay, errored, isOrthogonal }: OuterLayerOpts): OuterLayer {
  if (caption !== undefined) return "figure";
  if (overlay !== undefined && !errored) return "overlay";
  if (isOrthogonal && !errored) return "orthogonal";
  return "img";
}

export function Image(props: ImageProps) {
  const {
    src,
    srcSet,
    sizes,
    alt,
    size = "md",
    caption,
    overlay,
    rotation = 0,
    bordered = false,
    title,
    proxyFallbackSrc,
    className,
    loading,
  } = props;
  const lightbox = props.lightbox === true; const lightboxSrc = lightbox ? props.lightboxSrc : undefined; const externalOnClick = lightbox ? undefined : props.onClick;

  const lightboxCtx = useLightbox();
  const imgRef = useRef<HTMLImageElement>(null);
  // Two-stage load: try `src`, then `proxyFallbackSrc` once, then placeholder.
  // Failures live in the module-level `failedImageUrls` set (keyed by URL) so a
  // remount doesn't replay the sequence; `bumpAfterError` only forces a
  // re-render after we record a fresh failure (the set isn't reactive itself).
  const [, bumpAfterError] = useReducer((n: number) => n + 1, 0);
  const [locallyFailedSrc, setLocallyFailedSrc] = useState<string | null>(null);
  // An image with no intrinsic width — an SVG with only a `viewBox` — sizes
  // itself to its containing block. The lightbox <button> (and the figure /
  // overlay wrappers) are shrink-to-fit, so the two sizes depend on each other
  // and the browser resolves both to 0: the image loads, and nothing shows.
  // Detected from the DOM after load (loaded pixels, laid out at 0 wide, in a
  // container that has width) rather than guessed from the file extension;
  // the wrappers then take the container's width, and the image follows.
  const [stretch, setStretch] = useState(false);
  const noteLayout = (el: HTMLImageElement) => {
    if (stretch || !el.complete || el.naturalWidth === 0 || el.clientWidth > 0) return;
    const container = el.parentElement?.parentElement;
    if (container !== undefined && container !== null && container.clientWidth > 0) setStretch(true);
  };
  const fallbackSrc = proxyFallbackSrc !== undefined && proxyFallbackSrc !== src ? proxyFallbackSrc : undefined;
  const { displaySrc, errored } = getLoadState({
    src,
    fallbackSrc,
    locallyFailed: locallyFailedSrc === src,
  });
  const handleError = (failedSrc?: string) => {
    failedImageUrls.add(imageUrlKey(failedSrc ?? displaySrc));
    setLocallyFailedSrc(src);
    bumpAfterError();
  };

  // A failure that happens BEFORE React attaches `onError` is never delivered:
  // the synthetic handler is wired after the element exists, and a fast or
  // cached 404 has already fired `error` by then. The image then sits at the
  // browser's own broken glyph forever, with no placeholder — which is what an
  // in-box 404 looked like in practice, including across reloads, because the
  // second load fails exactly as quickly as the first.
  //
  // `complete` with a zero `naturalWidth` is the DOM's record of that: the
  // browser finished, and there are no pixels. Checking it once on mount
  // recovers the event React missed.
  useEffect(() => {
    const el = imgRef.current;
    if (el === null || errored) return;
    if (el.complete && el.naturalWidth === 0 && el.getAttribute("src") !== null) {
      handleError(el.currentSrc || displaySrc);
    }
    // The same race for `load`: a cached image is complete before the handler
    // attaches, so the collapsed-layout check runs here too.
    noteLayout(el);
    // `displaySrc` so a changed source is re-checked; `errored` so a placeholder
    // already showing does not re-enter.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleError and noteLayout are redefined every render; depending on them would re-run this on every render rather than on a source change.
  }, [displaySrc, errored]);

  const rotationStyle: CSSProperties | undefined = rotation !== 0 ? { transform: `rotate(${rotation}deg)` } : undefined;
  const isOrthogonal = rotation === 90 || rotation === 270;

  const activate: ((element: HTMLImageElement) => void) | null = errored
    ? null
    : lightbox
      ? (element) => lightboxCtx.openFromElement(element)
      : externalOnClick !== undefined
        ? () => externalOnClick()
        : null;

  // Determine which layer is the outermost wrapper so the caller's
  // className lands there. Layer order, inside-out: img → orthogonal
  // padding → overlay wrapper → figure (caption).
  const outerLayer = pickOuterLayer({ caption, overlay, errored, isOrthogonal });
  const imgExtra = outerLayer === "img" ? className : undefined;

  const base: ReactNode = errored ? (
    <ErrorPlaceholder alt={alt} size={size} bordered={bordered} extraClass={imgExtra} />
  ) : (
    <ImgElement
      src={displaySrc}
      srcSet={srcSet} sizes={sizes}
      alt={alt}
      size={size}
      bordered={bordered}
      rotationStyle={rotationStyle}
      title={title}
      onActivate={activate}
      onError={handleError}
      onLoad={noteLayout}
      stretch={stretch}
      lightbox={lightbox}
      lightboxSrc={lightboxSrc}
      lightboxCaption={typeof caption === "string" ? caption : undefined}
      imgRef={imgRef}
      extraClass={imgExtra}
      loading={loading}
    />
  );

  return assembleImage({ base, caption, overlay, errored, isOrthogonal, stretch, outerLayer, className });
}
