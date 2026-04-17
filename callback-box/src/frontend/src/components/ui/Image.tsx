import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { ImageLightbox } from "../ImageLightbox";

const SIZE_CLASSES = {
  thumb: "w-16 h-16 object-cover",
  sm: "max-w-xs max-h-64",
  md: "max-w-full max-h-96",
  lg: "max-w-full max-h-[32rem]",
} as const;

export type ImageSize = keyof typeof SIZE_CLASSES;
export type ImageRotation = 0 | 90 | 180 | 270;

interface BaseImageProps {
  src: string;
  alt: string;
  size?: ImageSize;
  caption?: ReactNode;
  overlay?: ReactNode;
  rotation?: ImageRotation;
  bordered?: boolean;
  title?: string;
}

export type ImageProps = BaseImageProps & (
  | { lightbox: true; onClick?: never }
  | { lightbox?: false; onClick?: () => void }
);

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

function ErrorPlaceholder({ alt, size, bordered }: { alt: string; size: ImageSize; bordered: boolean }) {
  const borderClass = bordered ? "border border-warm-300" : "border border-warm-200";
  return (
    <div
      className={`${SIZE_CLASSES[size]} ${borderClass} rounded bg-warm-100 flex flex-col items-center justify-center text-warm-500 text-xs p-2 gap-1`}
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
  alt: string;
  size: ImageSize;
  bordered: boolean;
  rotationStyle: CSSProperties | undefined;
  title: string | undefined;
  onActivate: (() => void) | null;
  onError: () => void;
  lightbox: boolean;
}

function ImgElement({ src, alt, size, bordered, rotationStyle, title, onActivate, onError, lightbox }: ImgElementProps) {
  const interactive = onActivate !== null;
  const handleKeyDown = (e: KeyboardEvent<HTMLImageElement>) => {
    if (onActivate !== null && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onActivate();
    }
  };
  const classes = [
    SIZE_CLASSES[size],
    "rounded",
    bordered ? "border border-warm-300" : "",
    interactive ? "cursor-pointer hover:opacity-90 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-gold" : "",
  ].filter(Boolean).join(" ");

  return (
    <img
      src={src}
      alt={alt}
      className={classes}
      style={rotationStyle}
      onClick={onActivate !== null ? onActivate : undefined}
      onKeyDown={interactive ? handleKeyDown : undefined}
      onError={onError}
      title={title}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive && lightbox ? `${alt} (click to zoom)` : undefined}
    />
  );
}

function wrapOrthogonal(node: ReactNode): ReactNode {
  return (
    <div className="flex items-center justify-center" style={{ padding: "15% 0" }}>
      {node}
    </div>
  );
}

function wrapWithOverlay(node: ReactNode, overlay: ReactNode): ReactNode {
  return (
    <div className="relative inline-block">
      {node}
      {overlay}
    </div>
  );
}

function wrapInFigure(node: ReactNode, caption: ReactNode): ReactNode {
  return (
    <figure className="inline-flex flex-col items-center">
      {node}
      <figcaption className="mt-1 max-w-full text-xs text-warm-600 italic text-center">
        {caption}
      </figcaption>
    </figure>
  );
}

export function Image(props: ImageProps) {
  const {
    src,
    alt,
    size = "md",
    caption,
    overlay,
    rotation = 0,
    bordered = false,
    title,
  } = props;
  const lightbox = props.lightbox === true;
  const externalOnClick = lightbox ? undefined : props.onClick;

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [errorSrc, setErrorSrc] = useState<string | null>(null);
  const errored = errorSrc === src;

  const rotationStyle: CSSProperties | undefined =
    rotation !== 0 ? { transform: `rotate(${rotation}deg)` } : undefined;
  const isOrthogonal = rotation === 90 || rotation === 270;

  const activate = errored
    ? null
    : lightbox
      ? () => setLightboxOpen(true)
      : externalOnClick !== undefined
        ? externalOnClick
        : null;

  const effectiveTitle = title !== undefined ? title : lightbox && !errored ? "Click to zoom" : undefined;

  let imgBlock: ReactNode = errored ? (
    <ErrorPlaceholder alt={alt} size={size} bordered={bordered} />
  ) : (
    <ImgElement
      src={src}
      alt={alt}
      size={size}
      bordered={bordered}
      rotationStyle={rotationStyle}
      title={effectiveTitle}
      onActivate={activate}
      onError={() => setErrorSrc(src)}
      lightbox={lightbox}
    />
  );

  if (isOrthogonal && !errored) {
    imgBlock = wrapOrthogonal(imgBlock);
  }
  if (overlay !== undefined && !errored) {
    imgBlock = wrapWithOverlay(imgBlock, overlay);
  }

  const rendered = caption !== undefined ? wrapInFigure(imgBlock, caption) : imgBlock;
  const lightboxCaption = typeof caption === "string" ? caption : undefined;

  return (
    <>
      {rendered}
      {lightbox && lightboxOpen && !errored ? (
        <ImageLightbox
          src={src}
          alt={alt}
          caption={lightboxCaption}
          onClose={() => setLightboxOpen(false)}
        />
      ) : null}
    </>
  );
}
