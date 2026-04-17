/**
 * Reusable lightbox overlay for viewing images at full size.
 *
 * Shows the image centered on a dark backdrop with controls to
 * open full-resolution in a new tab or close the lightbox.
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { CloseButton } from "./ui/CloseButton";
import { ExternalIconLink } from "./ui/ExternalIconLink";

export function ImageLightbox({ src, alt, caption, onClose }: { src: string; alt: string; caption?: string; onClose: () => void }) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const captionText = caption && caption.trim() !== "" ? caption : null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <figure
        className="relative max-w-[95vw] max-h-[95vh] flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={alt}
          className={`max-w-full rounded shadow-lg ${captionText ? "max-h-[80vh]" : "max-h-[92vh]"}`}
        />
        {captionText ? (
          <figcaption className="mt-3 max-w-[80ch] text-sm text-white/90 text-center px-4 leading-relaxed">
            {captionText}
          </figcaption>
        ) : null}
        <div className="absolute top-2 right-2 flex gap-2">
          <ExternalIconLink href={src} label="Open full size in new tab" onDark size="sm" />
          <CloseButton onClick={onClose} onDark size="sm" />
        </div>
      </figure>
    </div>,
    document.body
  );
}
