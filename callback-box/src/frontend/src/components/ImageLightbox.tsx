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
import { useLightboxGestures } from "../hooks/use-lightbox-gestures.js";

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
  // images can be empty; the frontend tsconfig lacks noUncheckedIndexedAccess,
  // so `images[safeIndex]` would type `current` as always-defined. `.at()` is
  // typed `T | undefined` regardless of that flag, keeping the guard honest.
  const current = images.at(safeIndex);
  const hasMany = total > 1;

  const step = (by: number) => (total === 0 ? 0 : ((safeIndex + by) % total + total) % total);

  // Gesture layer: double-tap zoom + pan, pinch, swipe-to-dismiss, and
  // horizontal swipe for prev/next. Must run before the `!current` early
  // return so hook order stays stable.
  const { rootRef, figureRef, wrapperRef, imgRef, peersRef } = useLightboxGestures({
    src: current?.src ?? "",
    onClose,
    canSwipe: hasMany,
    onNavigate: (by) => onIndexChange(step(by)),
  });

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

  const captionText = captionOf(current);
  const goPrev = () => onIndexChange(step(-1));
  const goNext = () => onIndexChange(step(1));

  return createPortal(
    <div
      ref={rootRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 touch-none select-none"
    >
      {/* Full-screen backdrop button. It stays behind the content by DOCUMENT
          ORDER (it's the first child, z-0) rather than by a competing z-index,
          so clicks on the actual content reach those elements instead — a real
          <button>, not a click handler on a div, so it's keyboard-reachable
          and announced. A capture-phase click listener on the root (wired by
          useLightboxGestures) eats the trailing click of a completed drag so a
          swipe-back doesn't also close. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close lightbox"
        className="absolute inset-0 z-0 cursor-default border-0 bg-transparent"
      />
      {hasMany ? (
        <NavButton direction="prev" onClick={goPrev} />
      ) : null}
      {/* The swipe peers: the neighbouring images parked one viewport to
          either side, so a horizontal drag reveals a real image rather than
          bare backdrop. The gesture layer translates THIS element by the same
          offset it gives the figure, so the three move as one strip. Rendered
          for the whole time the lightbox is open (not just mid-swipe) so the
          neighbours are already decoded when the drag starts, and so the drag
          needs no React state — the offset is written straight to the DOM.
          aria-hidden: they are decorative duplicates of images the arrows and
          arrow keys already reach. */}
      {hasMany ? (
        <div ref={peersRef} aria-hidden="true" className="pointer-events-none absolute inset-0">
          <SwipePeer image={images.at(step(-1))} side="prev" />
          <SwipePeer image={images.at(step(1))} side="next" />
        </div>
      ) : null}
      {/* Stacking: the figure is z-auto (NOT z-10 — that would open a stacking
          context that traps the controls' z-30 inside it, letting the sibling
          arrows' z-20 paint over the close button in a short-wide overlap). At
          z-auto the figure's static img content sits below the positioned
          arrows (preserving ef98ae6f's wide-image fix) while the controls'
          z-30 joins the ROOT stacking context and genuinely outranks them.
          pointer-events-none (with auto restored on visible children) lets
          clicks on the figure's transparent whitespace fall through to the
          backdrop and close. The figure also carries the dismiss transform +
          fade (written to its style by the gesture hook). */}
      <figure
        ref={figureRef}
        className="pointer-events-none relative max-w-[95vw] max-h-[95vh] flex flex-col items-center"
      >
        {/* Zoom/pan wrapper: the gesture surface and the transformed layer.
            The figure's width constraint transfers here (max-w-full min-w-0,
            flex-centered) while the img keeps its own max-w/max-h, so the
            fitted geometry is pixel-identical to before any gesture. */}
        <div
          ref={wrapperRef}
          className="pointer-events-auto touch-none select-none max-w-full min-w-0 flex items-center justify-center origin-center"
        >
          <img
            ref={imgRef}
            src={current.src}
            alt={current.alt}
            className={`max-w-full rounded shadow-lg ${captionText ? "max-h-[80vh]" : "max-h-[92vh]"}`}
          />
        </div>
        {captionText ? (
          <figcaption
            className="pointer-events-auto mt-3 max-w-[80ch] text-sm text-white/90 text-center px-4 leading-relaxed"
          >
            {captionText}
          </figcaption>
        ) : null}
        {/* z-30 keeps the controls above the nav arrows (z-20). The cluster is
            positioned against the FIGURE's top-right while an arrow is against
            the VIEWPORT's vertical centre, so for a short wide image the two
            land at nearly the same spot — and close must never be the thing
            that ends up underneath. This only works because the figure is
            z-auto: a z-10 there would trap this z-30 inside the figure's own
            stacking context, below the sibling arrows. Effective stack:
            backdrop 0 < figure content (auto) < arrows 20 < controls 30. */}
        <div
          className="pointer-events-auto absolute z-30 top-2 right-2 flex items-center gap-2"
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

function captionOf(image: LightboxImage): string | null {
  return image.caption && image.caption.trim() !== "" ? image.caption : null;
}

/**
 * One neighbouring image, parked a full viewport (plus a gutter) to the left
 * or right of centre. It mirrors the figure's own image sizing — including the
 * caption-dependent height cap — so that when a committed swipe lands, the
 * peer sits exactly where the figure's image will be and the index change
 * swaps identical pixels instead of flashing.
 */
function SwipePeer({ image, side }: { image: LightboxImage | undefined; side: "prev" | "next" }) {
  if (!image) return null;
  const offset = side === "prev" ? "calc(-100% - 2rem)" : "calc(100% + 2rem)";
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ transform: `translateX(${offset})` }}
    >
      <img
        src={image.src}
        alt=""
        className={`max-w-[95vw] rounded shadow-lg ${captionOf(image) ? "max-h-[80vh]" : "max-h-[92vh]"}`}
      />
    </div>
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
      /* z-20 lifts both arrows above the figure's static img content (the
         figure itself is z-auto). Before, at equal z-index the figure —
         rendered between the two buttons — painted over `prev` while `next`
         painted over the figure, so a wide image hid the back arrow and left
         the forward one showing. Keep both buttons above the figure rather
         than reordering the JSX — an ordering fix silently re-breaks the next
         time someone moves them. */
      className={`absolute z-20 top-1/2 -translate-y-1/2 ${positionClass} w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-white`}
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
