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
 *
 * A marker may also carry `data-image-card`, the box path of the image card it
 * shows. A link to an image card opens here instead of the card page, and
 * passes `openCard` so the lightbox can still offer "Open card".
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { LightboxImage } from "./ImageLightbox";
import { lazyOverlay } from "../lib/lazy-component";
import { isRecord } from "@shared/is-record";

// The viewer and its gesture code load when an image is first opened.
const ImageLightbox = lazyOverlay(() => import("./ImageLightbox"), (m) => m.ImageLightbox);

interface LightboxState {
  images: LightboxImage[];
  index: number;
  openCard: ((cardPath: string) => void) | undefined;
}

export interface OpenFromElementOptions {
  /** Opens the card an image came from; the lightbox shows "Open card" when given. */
  openCard?: (cardPath: string) => void;
}

interface LightboxContextValue {
  openList: (images: LightboxImage[], index: number) => void;
  /** False when `element` carries no `data-image-src` the document collects; nothing opened. */
  openFromElement: (element: HTMLElement, options?: OpenFromElementOptions) => boolean;
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
export function collectImages(root: ParentNode): LightboxImage[] {
  const merged: LightboxImage[] = [];
  const bySrc = new Map<string, LightboxImage>();
  // The first marker for a `src` keeps its place; a later one with the same
  // `src` can still say which card it came from (an embed, or chat's bulk
  // list, usually precedes the link that names the card).
  const add = (image: LightboxImage) => {
    const kept = bySrc.get(image.src);
    if (kept === undefined) {
      bySrc.set(image.src, image);
      merged.push(image);
    } else if (kept.cardPath === undefined && image.cardPath !== undefined) {
      kept.cardPath = image.cardPath;
    }
  };
  const nodes = root.querySelectorAll<HTMLElement>("[data-image-src], [data-image-list]");
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
        if (image) add(image);
      }
    } else {
      const src = node.dataset.imageSrc;
      if (!src) continue;
      add({
        src,
        alt: node.dataset.imageAlt || "",
        caption: node.dataset.imageCaption,
        cardPath: node.dataset.imageCard || undefined,
      });
    }
  }
  return merged;
}

function coerceLightboxImage(value: unknown): LightboxImage | null {
  if (!isRecord(value)) return null;
  if (typeof value.src !== "string" || value.src === "") return null;
  return {
    src: value.src,
    alt: typeof value.alt === "string" ? value.alt : "",
    caption: typeof value.caption === "string" ? value.caption : undefined,
    cardPath: typeof value.cardPath === "string" && value.cardPath !== "" ? value.cardPath : undefined,
  };
}

export function LightboxProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LightboxState | null>(null);

  const close = useCallback(() => setState(null), []);

  const openList = useCallback((images: LightboxImage[], index: number) => {
    if (images.length === 0) return;
    setState({ images, index, openCard: undefined });
  }, []);

  const openFromElement = useCallback((element: HTMLElement, options?: OpenFromElementOptions) => {
    const clickedSrc = element.dataset.imageSrc;
    const merged = collectImages(document);
    const index = clickedSrc === undefined
      ? -1
      : merged.findIndex((img) => img.src === clickedSrc);
    if (index === -1) return false;
    setState({ images: merged, index, openCard: options?.openCard });
    return true;
  }, []);

  const handleOpenCard = state?.openCard;

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
          onOpenCard={handleOpenCard}
        />
      ) : null}
    </LightboxContext.Provider>
  );
}

/** The lightbox when a provider is mounted; `null` for Markdown rendered outside the app shell (tests, server render). */
export function useOptionalLightbox(): LightboxContextValue | null {
  return useContext(LightboxContext);
}

export function useLightbox(): LightboxContextValue {
  const ctx = useContext(LightboxContext);
  if (!ctx) throw new LightboxContextError();
  return ctx;
}
