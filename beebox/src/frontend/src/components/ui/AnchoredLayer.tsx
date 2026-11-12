/**
 * The anchored layer: one owner for placing a panel beside a trigger or at a
 * point, and for dismissing it. `Menu` and `Popover` call `useAnchoredLayer`;
 * `<AnchoredLayer at>` places a free element (the selection "+" button).
 *
 * The layer is `position: fixed` from the anchor's viewport box, placed by
 * `placeAnchored` (`lib/anchored-placement.ts`: flip to the roomier side,
 * never outside the visible viewport, which shrinks under the iOS keyboard),
 * and re-placed on scroll, resize and its own size changes.
 */

import { useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useDismiss, type DismissReason } from "../../hooks/useDismiss";
import { useIsomorphicLayoutEffect } from "../../hooks/use-isomorphic-layout-effect";
import { placeAnchored, type AnchorAlign, type AnchorBox, type AnchorVertical } from "../../lib/anchored-placement";
import { cn } from "../../lib/cn";

export type { AnchorAlign, AnchorVertical };

/** A point in viewport (client) coordinates. */
export interface AnchorPoint {
  x: number;
  y: number;
}

/** What the layer is placed against: a trigger element, or a point. */
export type Anchor = { trigger: RefObject<Element | null> } | { at: AnchorPoint };

/** Why an anchored layer closed itself: a press outside, Escape, or (point anchors) a scroll or resize. */
export type LayerDismissReason = DismissReason | "moved";

const GAP_PX = 4;
const MARGIN_PX = 8;

/** Visible viewport bounds for fixed layers, including the iOS keyboard resize. */
function visibleViewport() {
  const viewport = window.visualViewport;
  return {
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
  };
}

function anchorBox(anchor: Anchor): AnchorBox | null {
  if ("at" in anchor) return { top: anchor.at.y, bottom: anchor.at.y, left: anchor.at.x, right: anchor.at.x };
  const element = anchor.trigger.current;
  if (element === null) return null;
  const rect = element.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
}

/** The layer's natural size: a scrolling layer's full content height plus its borders. */
function naturalSize(layer: HTMLElement): { width: number; height: number } {
  const rect = layer.getBoundingClientRect();
  return { width: rect.width, height: Math.max(rect.height, layer.scrollHeight + layer.offsetHeight - layer.clientHeight) };
}

function rootRem(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
}

export interface AnchoredLayerOptions {
  open: boolean;
  anchor: Anchor;
  /** The positioned element. */
  layer: RefObject<HTMLElement | null>;
  align: AnchorAlign;
  vertical: AnchorVertical;
  /** Space between anchor and layer in px. Default 4. */
  gap?: number;
  /** Re-place when this changes (a menu whose width class changes). */
  measureKey?: unknown;
  /**
   * Close on a press outside the trigger and the layer, and on Escape. A
   * point anchor does not move with the content, so a scroll outside the
   * layer or a resize also closes it (`"moved"`).
   */
  onDismiss?: (reason: LayerDismissReason) => void;
}

function usePointMovedDismiss({ open, layer, onDismiss }: { open: boolean; layer: RefObject<HTMLElement | null>; onDismiss: ((reason: LayerDismissReason) => void) | null }): void {
  const latest = useRef(onDismiss);
  useIsomorphicLayoutEffect(() => { latest.current = onDismiss; });
  const active = open && onDismiss !== null;
  useIsomorphicLayoutEffect(() => {
    if (!active) return;
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && layer.current?.contains(event.target) === true) return;
      latest.current?.("moved");
    };
    const onResize = () => latest.current?.("moved");
    // Scroll events are delivered a frame late: one from before the open
    // (focusing the row that opened it scrolled it into view) must not close it.
    const frame = requestAnimationFrame(() => window.addEventListener("scroll", onScroll, true));
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [active, layer]);
}

/** Place `layer` against `anchor` while open; returns its fixed-position style. */
export function useAnchoredLayer({ open, anchor, layer, align, vertical, gap, measureKey, onDismiss }: AnchoredLayerOptions): CSSProperties {
  // Fixed from the first render: a layer laid out in the page flow until it
  // is measured would lengthen the page, and focusing into it would scroll.
  const [coords, setCoords] = useState<CSSProperties>({ position: "fixed", top: 0, left: 0 });
  const isPoint = "at" in anchor;
  const pointX = isPoint ? anchor.at.x : null;
  const pointY = isPoint ? anchor.at.y : null;
  const triggerRef = isPoint ? null : anchor.trigger;
  const latestAnchor = useRef(anchor);
  useIsomorphicLayoutEffect(() => { latestAnchor.current = anchor; });
  const gapPx = gap ?? GAP_PX;

  useIsomorphicLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const element = layer.current;
      const box = anchorBox(latestAnchor.current);
      if (element === null || box === null) return;
      const placed = placeAnchored({
        anchor: box,
        size: naturalSize(element),
        viewport: visibleViewport(),
        align,
        vertical,
        gap: gapPx,
        margin: MARGIN_PX,
        rem: rootRem(),
      });
      setCoords({ position: "fixed", top: placed.top, left: placed.left, maxHeight: placed.maxHeight, maxWidth: placed.maxWidth });
    };
    update();
    // A point does not move with content; a trigger does, so its layer follows.
    const follow = !isPoint;
    if (follow) window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    // A layer whose size eases (a menu's width transition between panels) or
    // whose content loads late re-places on every size change.
    const element = layer.current;
    const resizeObserver = element === null ? null : new ResizeObserver(update);
    if (element !== null) resizeObserver?.observe(element);
    return () => {
      if (follow) window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      resizeObserver?.disconnect();
    };
  }, [open, align, vertical, gapPx, measureKey, isPoint, pointX, pointY, layer]);

  const boundary = triggerRef === null ? [layer] : [triggerRef, layer];
  useDismiss({ boundary, open: open && onDismiss !== undefined, onDismiss: (reason) => onDismiss?.(reason) });
  usePointMovedDismiss({ open: open && isPoint, layer, onDismiss: onDismiss ?? null });
  return coords;
}

export interface AnchoredLayerProps {
  /** The point the layer is placed at, in viewport coordinates. */
  at: AnchorPoint;
  children: ReactNode;
  /** Layer edge aligned to the point. Default `"left"`. */
  align?: AnchorAlign;
  /** Default `"below"`. */
  vertical?: AnchorVertical;
  /** Space between the point and the layer in px. Default 0. */
  gap?: number;
  /** Outer-layout classes. */
  className?: string;
}

/**
 * A free element placed at a viewport point and kept inside the visible
 * viewport (the selection "+" button). It has no dismiss of its own: the
 * caller owns when it shows.
 */
export function AnchoredLayer({ at, children, align, vertical, gap, className }: AnchoredLayerProps) {
  const layer = useRef<HTMLDivElement>(null);
  const style = useAnchoredLayer({ open: true, anchor: { at }, layer, align: align ?? "left", vertical: vertical ?? "below", gap: gap ?? 0 });
  return (
    <div ref={layer} style={style} className={cn("z-50 w-max", className)}>
      {children}
    </div>
  );
}
