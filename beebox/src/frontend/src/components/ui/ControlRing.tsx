import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ringBox, RING_DURATION_MS, RING_PADDING } from "../../lib/ui-scan/ring";

/**
 * The ring a `control:` pointer draws around the control it points at.
 *
 * An absolutely-positioned overlay in the accent colour (the palette's focus-ring
 * role), `pointer-events: none` so it never intercepts the click it is inviting,
 * removed on a timer. It tracks the target's box on every frame while it is up,
 * so a control that moves — a scroll settling, the keyboard opening — keeps its
 * ring. Under `prefers-reduced-motion` the ring is static; the pulse is behind
 * `motion-safe:`.
 *
 * Deliberately not a spotlight: no mask, no popover, no modal layer. Taking over
 * the screen is the part of a guided tour this feature rejected.
 */
export function ControlRing({ target, onDone }: { target: HTMLElement; onDone: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let frame = 0;
    const track = () => {
      const node = ref.current;
      if (node !== null) {
        const box = ringBox(target.getBoundingClientRect(), RING_PADDING);
        node.style.top = `${box.top}px`;
        node.style.left = `${box.left}px`;
        node.style.width = `${box.width}px`;
        node.style.height = `${box.height}px`;
      }
      frame = requestAnimationFrame(track);
    };
    track();
    const timer = setTimeout(onDone, RING_DURATION_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [target, onDone]);

  const initial = ringBox(target.getBoundingClientRect(), RING_PADDING);
  return createPortal(
    <div
      ref={ref}
      aria-hidden="true"
      className="fixed z-50 rounded-md border-2 border-accent ring-4 ring-accent/30 pointer-events-none motion-safe:animate-pulse"
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
