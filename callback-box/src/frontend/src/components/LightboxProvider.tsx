/**
 * Lightbox provider: owns the overlay's open state and current image
 * list, exposed via `useLightbox()` to any descendant.
 *
 * Two open paths:
 *   - `openList(images, index)` — caller supplies the explicit list
 *     (used by ChatAttachments to navigate within input attachments).
 *   - `openFromElement(element)` — walks the DOM for elements carrying
 *     `data-image-src` markers, derives a list in document order, and
 *     opens at the index matching the clicked element. Used by the
 *     <Image lightbox> primitive so any image marked with these data
 *     attributes becomes part of one navigation set.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { ImageLightbox, type LightboxImage } from "./ImageLightbox";

interface LightboxState {
  images: LightboxImage[];
  index: number;
}

interface LightboxContextValue {
  openList: (images: LightboxImage[], index: number) => void;
  openFromElement: (element: HTMLElement) => void;
  close: () => void;
}

const LightboxContext = createContext<LightboxContextValue | null>(null);

class LightboxContextError extends Error {
  constructor() {
    super("useLightbox must be used inside <LightboxProvider>");
    this.name = "LightboxContextError";
  }
}

/**
 * Walk the document for both individual `[data-image-src]` markers and
 * bulk `[data-image-list]` JSON containers, returning a single ordered
 * list deduped by `src`. Bulk lists exist so that virtualized chats can
 * surface all images, not just those currently mounted; document-order
 * traversal lets a bulk list near the top of the chat establish the
 * canonical ordering, while any individual marker the bulk list missed
 * still shows up at its document position.
 */
function collectImages(): LightboxImage[] {
  const merged: LightboxImage[] = [];
  const seen = new Set<string>();
  const nodes = document.querySelectorAll<HTMLElement>("[data-image-src], [data-image-list]");
  for (const node of nodes) {
    if (node.hasAttribute("data-image-list")) {
      const raw = node.textContent;
      if (raw.trim() === "") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        console.warn("LightboxProvider: invalid JSON in data-image-list", e);
        continue;
      }
      if (!Array.isArray(parsed)) continue;
      for (const entry of parsed) {
        const image = coerceLightboxImage(entry);
        if (image && !seen.has(image.src)) {
          seen.add(image.src);
          merged.push(image);
        }
      }
    } else {
      const src = node.dataset.imageSrc;
      if (!src || seen.has(src)) continue;
      seen.add(src);
      merged.push({
        src,
        alt: node.dataset.imageAlt || "",
        caption: node.dataset.imageCaption,
      });
    }
  }
  return merged;
}

function coerceLightboxImage(value: unknown): LightboxImage | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.src !== "string" || obj.src === "") return null;
  return {
    src: obj.src,
    alt: typeof obj.alt === "string" ? obj.alt : "",
    caption: typeof obj.caption === "string" ? obj.caption : undefined,
  };
}

export function LightboxProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LightboxState | null>(null);

  const close = useCallback(() => setState(null), []);

  const openList = useCallback((images: LightboxImage[], index: number) => {
    if (images.length === 0) return;
    setState({ images, index });
  }, []);

  const openFromElement = useCallback((element: HTMLElement) => {
    const clickedSrc = element.dataset.imageSrc;
    const merged = collectImages();
    if (merged.length === 0) return;
    const index = clickedSrc === undefined
      ? -1
      : merged.findIndex((img) => img.src === clickedSrc);
    if (index === -1) return;
    setState({ images: merged, index });
  }, []);

  const value = useMemo<LightboxContextValue>(
    () => ({ openList, openFromElement, close }),
    [openList, openFromElement, close],
  );

  return (
    <LightboxContext.Provider value={value}>
      {children}
      {state ? (
        <ImageLightbox
          images={state.images}
          index={state.index}
          onIndexChange={(index) => setState((s) => (s ? { ...s, index } : s))}
          onClose={close}
        />
      ) : null}
    </LightboxContext.Provider>
  );
}

export function useLightbox(): LightboxContextValue {
  const ctx = useContext(LightboxContext);
  if (!ctx) throw new LightboxContextError();
  return ctx;
}
