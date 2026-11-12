/**
 * Dismiss an open layer on a mousedown outside it or on Escape. `boundary`
 * lists the regions that count as inside: a trigger and its panel, or a
 * point menu's panel alone. A press outside every one of them dismisses.
 *
 * Escape goes to the most recently opened layer only (`lib/escape-layers`,
 * shared with modal dialogs), which consumes it (`preventDefault`), so a
 * popover inside a modal or a menu closes alone and its parent stays open.
 * An Escape another handler already consumed leaves the layer open, so a
 * nested control that handles Escape itself does not also close its parent.
 *
 * Only `components/ui/AnchoredLayer.tsx` imports this (lint-enforced).
 */

import { useEffect, useRef, type RefObject } from "react";
import { pushEscapeLayer } from "../lib/escape-layers";

export type DismissReason = "outside" | "escape";

export function useDismiss({ boundary, open, onDismiss }: {
  boundary: readonly RefObject<Element | null>[];
  open: boolean;
  onDismiss: (reason: DismissReason) => void;
}): void {
  const latest = useRef({ boundary, onDismiss });
  useEffect(() => { latest.current = { boundary, onDismiss }; });
  useEffect(() => {
    if (!open) return;
    const layer = pushEscapeLayer();
    function handlePointer(e: MouseEvent) {
      const target = e.target;
      if (!(target instanceof Node)) return;
      const regions = latest.current.boundary.map((ref) => ref.current).filter((el) => el !== null);
      if (regions.length === 0 || regions.some((el) => el.contains(target))) return;
      latest.current.onDismiss("outside");
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented || !layer.ownsEscape()) return;
      e.preventDefault();
      latest.current.onDismiss("escape");
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      layer.release();
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);
}
