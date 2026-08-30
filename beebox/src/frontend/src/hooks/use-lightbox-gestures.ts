/**
 * Pointer-gesture layer for {@link ImageLightbox}: double-tap zoom + pan,
 * pinch, and swipe-to-dismiss. This hook is a thin wiring layer — it owns the
 * element refs and the {@link LightboxGestureController} lifecycle; all state,
 * math, and DOM writes live in `lib/lightbox-*`. Returns the four refs the
 * component attaches to its root, figure, zoom wrapper, and img.
 */

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { LightboxGestureController } from "../lib/lightbox-gesture-controller.js";

export interface LightboxGestureRefs {
  rootRef: RefObject<HTMLDivElement>;
  figureRef: RefObject<HTMLElement>;
  wrapperRef: RefObject<HTMLDivElement>;
  imgRef: RefObject<HTMLImageElement>;
  peersRef: RefObject<HTMLDivElement>;
}

export function useLightboxGestures({
  imageKey,
  onClose,
  onNavigate,
  canSwipe,
}: {
  /**
   * Identity of the image on screen — reset runs whenever this changes. It is
   * the index AND the src, not the src alone: two entries can legitimately
   * share a URL, and keying on the URL would skip the reset between them,
   * stranding a committed swipe off-screen (or carrying zoom across).
   */
  imageKey: string;
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
      elements: { root, figure, wrapper, img, peers: () => peersRef.current },
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

  // Reset all gesture state for a swapped-in image (the component is reused
  // across navigation). This MUST be a layout effect: a committed swipe leaves
  // the figure parked off-screen and the peers holding the OLD neighbours, and
  // React has already re-rendered both with the new index by the time effects
  // run. A passive useEffect would let the browser paint that intermediate
  // frame first — the new next-image sitting where the current one belongs.
  useLayoutEffect(() => {
    controllerRef.current?.reset();
  }, [imageKey]);

  return { rootRef, figureRef, wrapperRef, imgRef, peersRef };
}
