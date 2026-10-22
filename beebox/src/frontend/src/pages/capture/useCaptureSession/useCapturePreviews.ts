/**
 * Thumbnails for the photos added to a capture: one object URL per photo
 * index, made the first time a photo is seen and released when the overlay
 * closes. A retry replays the same blob at the same index, so it keeps the
 * URL it already has. A photo staged before a resume has no blob here and
 * stays null.
 */

import { useState, useRef, useCallback, useEffect } from "react";

export interface CapturePreviews {
  /** An object URL per photo index, or null for a photo this page never held. */
  photoPreviews: (string | null)[];
  /** Give photo `index` a thumbnail, unless it has one. */
  notePreview: (opts: { index: number; blob: Blob }) => void;
  resetPreviews: () => void;
}

export function useCapturePreviews(): CapturePreviews {
  const [photoPreviews, setPhotoPreviews] = useState<(string | null)[]>([]);
  // The URLs by index: the one place they are created, so the one place they are released.
  const urls = useRef(new Map<number, string>());

  const notePreview = useCallback(({ index, blob }: { index: number; blob: Blob }) => {
    if (urls.current.has(index)) return;
    const url = URL.createObjectURL(blob);
    urls.current.set(index, url);
    setPhotoPreviews((prev) => {
      const next = Array.from({ length: Math.max(prev.length, index + 1) }, (_v, i) => prev[i] ?? null);
      next[index] = url;
      return next;
    });
  }, []);

  const resetPreviews = useCallback(() => {
    revokeAll(urls.current);
    setPhotoPreviews([]);
  }, []);

  useEffect(() => {
    const held = urls.current;
    return () => { revokeAll(held); };
  }, []);

  return { photoPreviews, notePreview, resetPreviews };
}

function revokeAll(urls: Map<number, string>): void {
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
}
