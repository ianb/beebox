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
  peersRef: RefObject<HTMLDivElement>;
}

export function useLightboxGestures({
  src,
  onClose,
  onNavigate,
  canSwipe,
}: {
  src: string;
  onClose: () => void;
  /** Move the selection by `step` (`-1` previous, `+1` next), wrapping. */
  onNavigate: (step: -1 | 1) => void;
  /** Whether there is a neighbour to swipe to at all. */
  canSwipe: boolean;
}): LightboxGestureRefs {
  const rootRef = useRef<HTMLDivElement>(null);
  const figureRef = useRef<HTMLElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const peersRef = useRef<HTMLDivElement>(null);

  // Keep the latest callbacks and the swipe-ability flag reachable without
  // re-subscribing the controller (which would drop an in-flight gesture).
  const onCloseRef = useRef(onClose);
  const onNavigateRef = useRef(onNavigate);
  const canSwipeRef = useRef(canSwipe);
  useEffect(() => {
    onCloseRef.current = onClose;
    onNavigateRef.current = onNavigate;
    canSwipeRef.current = canSwipe;
  });

  const controllerRef = useRef<LightboxGestureController | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    const figure = figureRef.current;
    const wrapper = wrapperRef.current;
    const img = imgRef.current;
    if (!root || !figure || !wrapper || !img) return;
    const controller = new LightboxGestureController({
      elements: { root, figure, wrapper, img, peers: peersRef.current },
      onClose: () => onCloseRef.current(),
      onNavigate: (step) => onNavigateRef.current(step),
      canSwipe: () => canSwipeRef.current,
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

  return { rootRef, figureRef, wrapperRef, imgRef, peersRef };
}
