import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";
import { ringBox, RING_PADDING, type RingBox } from "../../lib/ui-scan/ring";

export type ControlRingTone = "accent" | "subtle";

export type ControlRingProps = {
  /**
   * What the ring goes around. An element is tracked on every frame, so a
   * control that moves (a scroll settling, the keyboard opening) keeps its
   * ring; a rect is drawn where it is, and the caller passes a new one.
   */
  target: HTMLElement | DOMRect;
  /**
   * `accent` (default): a pulsing accent ring that calls attention to a
   * control. `subtle`: a static accent outline with a light fill, for the
   * block a pointer is over.
   */
  tone?: ControlRingTone;
} & (
  | {
      /** Remove the ring after this long: `onDone` runs and the caller unmounts it. */
      durationMs: number;
      onDone: () => void;
    }
  | { durationMs?: undefined; onDone?: undefined }
);

const TONE_CLASSES: Record<ControlRingTone, string> = {
  accent: "rounded-md border-2 border-accent ring-4 ring-accent/30 animate-pulse",
  subtle: "rounded-md border-2 border-accent bg-accent/10",
};

function boxOf(target: HTMLElement | DOMRect): RingBox {
  return ringBox(target instanceof HTMLElement ? target.getBoundingClientRect() : target, RING_PADDING);
}

function place(node: HTMLElement, box: RingBox): void {
  node.style.top = `${box.top}px`;
  node.style.left = `${box.left}px`;
  node.style.width = `${box.width}px`;
  node.style.height = `${box.height}px`;
}

/**
 * A ring drawn around a control or a block: the one viewport-fixed highlight
 * rectangle. A `control:` pointer rings the control it points at; selection
 * capture's point mode outlines the block under the pointer.
 *
 * Inflated by `RING_PADDING` so it does not cover its target, and
 * `pointer-events: none`, so it never intercepts the click it is inviting.
 * Under `prefers-reduced-motion` the accent ring is static: the global rule in
 * `index.css` stops the pulse.
 *
 * Deliberately not a spotlight: no mask, no popover, no modal layer. Taking over
 * the screen is the part of a guided tour this feature rejected.
 */
export function ControlRing({ target, tone, durationMs, onDone }: ControlRingProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!(target instanceof HTMLElement)) return;
    let frame = 0;
    const track = () => {
      if (ref.current !== null) place(ref.current, boxOf(target));
      frame = requestAnimationFrame(track);
    };
    track();
    return () => cancelAnimationFrame(frame);
  }, [target]);

  useEffect(() => {
    if (durationMs === undefined) return;
    const timer = setTimeout(onDone, durationMs);
    return () => clearTimeout(timer);
  }, [durationMs, onDone]);

  const initial = boxOf(target);
  return createPortal(
    <div
      ref={ref}
      aria-hidden="true"
      className={cn("pointer-events-none fixed z-50", TONE_CLASSES[tone ?? "accent"])}
      style={{
        top: `${initial.top}px`,
        left: `${initial.left}px`,
        width: `${initial.width}px`,
        height: `${initial.height}px`,
      }}
    />,
    document.body,
  );
}
