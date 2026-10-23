/**
 * Dismiss an open popover on a mousedown outside it or on Escape. `root` is
 * the popover's element; `portal` is a part rendered elsewhere in the
 * document (a portaled menu), which also counts as inside. An Escape that
 * another handler already consumed (`defaultPrevented`) leaves the popover
 * open, so a nested control that handles Escape itself does not also close
 * its parent.
 */

import { useEffect, type RefObject } from "react";

export function useDismiss({ root, portal, open, onDismiss }: {
  root: RefObject<Element | null>;
  portal?: RefObject<Element | null>;
  open: boolean;
  onDismiss: () => void;
}): void {
  useEffect(() => {
    if (!open) return;
    function handlePointer(e: MouseEvent) {
      const target = e.target;
      if (root.current === null || !(target instanceof Node)) return;
      if (root.current.contains(target) || portal?.current?.contains(target) === true) return;
      onDismiss();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented) onDismiss();
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [root, portal, open, onDismiss]);
}
