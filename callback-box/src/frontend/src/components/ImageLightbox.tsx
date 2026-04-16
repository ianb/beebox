/**
 * Reusable lightbox overlay for viewing images at full size.
 *
 * Shows the image centered on a dark backdrop with controls to
 * open full-resolution in a new tab or close the lightbox.
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";

function ExternalLinkIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
    </svg>
  );
}

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
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-white/90 hover:bg-white text-warm-700 rounded-full w-8 h-8 flex items-center justify-center shadow"
            title="Open full size in new tab"
          >
            <ExternalLinkIcon />
          </a>
          <button
            onClick={onClose}
            className="bg-white/90 hover:bg-white text-warm-700 rounded-full w-8 h-8 flex items-center justify-center shadow text-sm"
            title="Close"
          >
            &times;
          </button>
        </div>
      </figure>
    </div>,
    document.body
  );
}
