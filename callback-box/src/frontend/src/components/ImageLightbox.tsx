/**
 * Reusable lightbox overlay for viewing images at full size.
 *
 * Shows the image centered on a dark backdrop with controls to
 * open full-resolution in a new tab or close the lightbox.
 *
 * Takes a list of images plus a current index. When the list has
 * more than one entry, prev/next buttons appear and the left/right
 * arrow keys navigate (wrapping at the ends).
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { CloseButton } from "./ui/CloseButton";
import { ExternalIconLink } from "./ui/ExternalIconLink";

export interface LightboxImage {
  src: string;
  alt: string;
  caption?: string;
}

interface ImageLightboxProps {
  images: LightboxImage[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

export function ImageLightbox({ images, index, onIndexChange, onClose }: ImageLightboxProps) {
  const total = images.length;
  const safeIndex = total === 0 ? 0 : ((index % total) + total) % total;
  const current = images[safeIndex];
  const hasMany = total > 1;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        e.preventDefault();
        onClose();
        return;
      }
      if (!hasMany) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onIndexChange((safeIndex - 1 + total) % total);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onIndexChange((safeIndex + 1) % total);
      }
    };
    document.addEventListener("keydown", handleKey, { capture: true });
    return () => document.removeEventListener("keydown", handleKey, { capture: true });
  }, [onClose, onIndexChange, safeIndex, total, hasMany]);

  if (!current) return null;

  const captionText = current.caption && current.caption.trim() !== "" ? current.caption : null;
  const goPrev = () => onIndexChange((safeIndex - 1 + total) % total);
  const goNext = () => onIndexChange((safeIndex + 1) % total);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      {/* Full-screen backdrop button, behind the figure/nav in stacking order
          (z-0 vs their z-10) so clicks on the actual content reach those
          elements instead — a real <button>, not a click handler bolted onto
          a plain div, so it's keyboard-reachable and announced correctly. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close lightbox"
        className="absolute inset-0 z-0 cursor-default border-0 bg-transparent"
      />
      {hasMany ? (
        <NavButton direction="prev" onClick={goPrev} />
      ) : null}
      <figure
        className="relative z-10 max-w-[95vw] max-h-[95vh] flex flex-col items-center"
      >
        <img
          src={current.src}
          alt={current.alt}
          className={`max-w-full rounded shadow-lg ${captionText ? "max-h-[80vh]" : "max-h-[92vh]"}`}
        />
        {captionText ? (
          <figcaption
            className="mt-3 max-w-[80ch] text-sm text-white/90 text-center px-4 leading-relaxed"
          >
            {captionText}
          </figcaption>
        ) : null}
        <div
          className="absolute top-2 right-2 flex items-center gap-2"
        >
          {hasMany ? (
            <span className="text-xs text-white/80 bg-black/40 rounded px-2 py-0.5 font-mono">
              {safeIndex + 1} / {total}
            </span>
          ) : null}
          <ExternalIconLink href={current.src} label="Open full size in new tab" onDark size="sm" />
          <CloseButton onClick={onClose} onDark size="sm" />
        </div>
      </figure>
      {hasMany ? (
        <NavButton direction="next" onClick={goNext} />
      ) : null}
    </div>,
    document.body
  );
}

function NavButton({ direction, onClick }: { direction: "prev" | "next"; onClick: () => void }) {
  const isPrev = direction === "prev";
  const positionClass = isPrev ? "left-2 sm:left-4" : "right-2 sm:right-4";
  const label = isPrev ? "Previous image" : "Next image";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`absolute z-10 top-1/2 -translate-y-1/2 ${positionClass} w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-white`}
    >
      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
        {isPrev ? (
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        )}
      </svg>
    </button>
  );
}
