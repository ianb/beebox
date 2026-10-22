import { useEffect, useRef } from "react";

const walkers = new URL("../../themes/doodlebit-walkers.svg", import.meta.url).href;

/** Advance the desk's cellular sprites with mouse travel; hold still between moves. */
export function useDoodlebitMotion(active: boolean) {
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = surface.current;
    if (!active || !element) return;
    const motion = matchMedia("(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)");
    let previous: { x: number; y: number } | undefined;
    let distance = 0;
    let frame = 0;
    const pause = () => {
      previous = undefined;
      distance = 0;
    };
    const move = (event: PointerEvent) => {
      const target = event.target;
      const isElement = target instanceof Element;
      const desk = isElement && target.closest(".bbx-theme-studio .bbx-box-presentation, .bbx-conversation-desk, .bbx-companion-desk[data-active-card], .bbx-interface-card-desk[data-card-content='card']");
      const covered = isElement && target.closest(".bbx-card-theme, .bbx-card-surface, .bbx-app-nav, .bbx-interface-tabstrip, .bbx-chat-user-paper, .bbx-chat-reply-material, .bbx-chat-callout, .bbx-composer-material, .bbx-chat-meta-material, .bbx-chat-pending-material, .bbx-chat-empty-label, button, a, input, textarea, select, summary, label, [tabindex], [role='button'], [role='tab'], [role='menuitem'], [role='dialog']");
      if (!motion.matches || event.pointerType !== "mouse" || !desk || covered) {
        pause();
        return;
      }
      const current = { x: event.clientX, y: event.clientY };
      if (previous) distance += Math.hypot(current.x - previous.x, current.y - previous.y);
      previous = current;
      const steps = Math.floor(distance / 12);
      if (steps === 0) return;
      distance %= 12;
      frame = (frame + steps) % 32;
      element.style.setProperty("--doodlebit-walkers", `url("${walkers}#frame${frame}")`);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerleave", pause);
    element.addEventListener("pointercancel", pause);
    motion.addEventListener("change", pause);
    return () => {
      element.style.removeProperty("--doodlebit-walkers");
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerleave", pause);
      element.removeEventListener("pointercancel", pause);
      motion.removeEventListener("change", pause);
    };
  }, [active]);
  return surface;
}
