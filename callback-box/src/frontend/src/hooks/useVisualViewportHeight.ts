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
 * We only pin the shell to `vv.height` while the on-screen keyboard is up. With
 * the keyboard closed, `visualViewport.resize` still fires continuously as the
 * mobile URL bar collapses/expands during a scroll or fling — writing each of
 * those transient heights back to `--app-height` made the shell (and with it
 * the composer) visibly grow/jitter as you scrolled (the "composer grows on
 * scroll" bug). CSS `100dvh` already tracks the URL-bar chrome smoothly, so
 * when the keyboard is closed we drop the override and let the fallback handle
 * it; the JS override earns its keep only for the keyboard case, where neither
 * `100dvh` nor the layout viewport shrinks on iOS.
 *
 * "Keyboard open" is inferred from a large gap between the layout viewport
 * (`window.innerHeight`, stable across the keyboard on iOS) and the visual
 * viewport — the URL bar is ~60px, the keyboard ~250-350px, so a 150px
 * threshold separates them cleanly.
 *
 * No-op where the API is absent (older browsers) — the CSS falls back to
 * `100dvh` via the variable's default.
 */
const KEYBOARD_GAP_PX = 150;

export function useVisualViewportHeight(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      const keyboardOpen = window.innerHeight - vv.height > KEYBOARD_GAP_PX;
      if (keyboardOpen) {
        document.documentElement.style.setProperty("--app-height", `${vv.height}px`);
      } else {
        document.documentElement.style.removeProperty("--app-height");
      }
    };
    apply();
    vv.addEventListener("resize", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      document.documentElement.style.removeProperty("--app-height");
    };
  }, []);
}
