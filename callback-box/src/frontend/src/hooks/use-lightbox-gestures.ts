/**
 * Pointer-gesture layer for {@link ImageLightbox}: double-tap zoom + pan,
 * pinch, and swipe-to-dismiss. This hook is a thin wiring layer — it owns the
 * element refs and the {@link LightboxGestureController} lifecycle; all state,
 * math, and DOM writes live in `lib/lightbox-*`. Returns the four refs the
 * component attaches to its root, figure, zoom wrapper, and img.
 */

import { useEffect, useRef, type RefObject } from "react";
import { LightboxGestureController } from "../lib/lightbox-gesture-controller.js";

export interface LightboxGestureRefs {
  rootRef: RefObject<HTMLDivElement>;
  figureRef: RefObject<HTMLElement>;
  wrapperRef: RefObject<HTMLDivElement>;
  imgRef: RefObject<HTMLImageElement>;
}

export function useLightboxGestures({ src, onClose }: { src: string; onClose: () => void }): LightboxGestureRefs {
  const rootRef = useRef<HTMLDivElement>(null);
  const figureRef = useRef<HTMLElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Keep the latest onClose reachable without re-subscribing the controller.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const controllerRef = useRef<LightboxGestureController | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    const figure = figureRef.current;
    const wrapper = wrapperRef.current;
    const img = imgRef.current;
    if (!root || !figure || !wrapper || !img) return;
    const controller = new LightboxGestureController({
      elements: { root, figure, wrapper, img },
      onClose: () => onCloseRef.current(),
    });
    controllerRef.current = controller;
    const detach = controller.attach();
    return () => {
      detach();
      controllerRef.current = null;
    };
  }, []);

  // Reset all gesture state before a swapped-in image renders (the component
  // is reused across navigation).
  useEffect(() => {
    controllerRef.current?.reset();
  }, [src]);

  return { rootRef, figureRef, wrapperRef, imgRef };
}
