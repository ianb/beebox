import { useEffect } from "react";

/**
 * Mirror the visual-viewport height into a `--app-height` CSS variable so the
 * app shell can size to the *visible* area rather than the layout viewport.
 *
 * On iOS Safari the on-screen keyboard does not shrink the layout viewport
 * (nor `100dvh`) — it slides the layout viewport up behind the keyboard, so a
 * bottom-anchored composer ends up hidden. Binding the shell height to
 * `window.visualViewport.height` keeps the composer on screen, and because the
 * chat scroller shrinks with it, the scroll controller's ResizeObserver re-pins
 * to the bottom automatically when the keyboard opens/closes (no extra wiring).
 *
 * No-op where the API is absent (older browsers) — the CSS falls back to
 * `100dvh` via the variable's default.
 */
export function useVisualViewportHeight(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      document.documentElement.style.setProperty("--app-height", `${vv.height}px`);
    };
    apply();
    vv.addEventListener("resize", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      document.documentElement.style.removeProperty("--app-height");
    };
  }, []);
}
