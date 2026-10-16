import { useEffect, useRef } from "react";

/** A few pixels of desk movement while a mouse crosses exposed background. */
export function useDoodlebitMotion(active: boolean) {
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = surface.current;
    if (!active || !element) return;
    const motion = matchMedia("(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)");
    let settle: ReturnType<typeof setTimeout> | undefined;
    const reset = () => {
      clearTimeout(settle);
      element.style.removeProperty("--doodlebit-x");
      element.style.removeProperty("--doodlebit-y");
    };
    const move = (event: PointerEvent) => {
      if (!motion.matches || event.pointerType !== "mouse" || !(event.target instanceof Element)
        || event.target.closest(".bbx-card-theme, .bbx-app-nav, .bbx-interface-tabstrip, .bbx-chat-user-paper, .bbx-chat-reply-material, .bbx-chat-callout, .bbx-composer-material, .bbx-chat-meta-material, .bbx-chat-pending-material, button, a, input, textarea, select, [role='dialog']")) {
        reset();
        return;
      }
      const shift = (delta: number) => `${Math.round(Math.max(-6, Math.min(6, delta * 0.6)) / 2) * 2}px`;
      element.style.setProperty("--doodlebit-x", shift(event.movementX));
      element.style.setProperty("--doodlebit-y", shift(event.movementY));
      clearTimeout(settle);
      settle = setTimeout(reset, 160);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerleave", reset);
    motion.addEventListener("change", reset);
    return () => {
      reset();
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerleave", reset);
      motion.removeEventListener("change", reset);
    };
  }, [active]);
  return surface;
}
