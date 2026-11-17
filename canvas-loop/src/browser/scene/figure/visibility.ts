// Sleep while off screen: what a figure watches to suspend and resume its
// runtime, and to redraw when a web font loads. Split from engine.ts, which
// is at its size limit; the figure starter (start.ts) is its one user.
import type { Runtime } from "../../runtime/engine.js";

/** What `watchVisibility` drives: a runtime, or a figure that also frees its GPU resources while asleep. */
export type Sleeper = Pick<Runtime, "suspend" | "resume" | "invalidate" | "fontsLoaded">;

/**
 * Sleep while off screen: suspend the runtime's loop when the canvas leaves
 * the viewport (with a margin, so it wakes just before it scrolls in) and
 * resume it on return. Also redraw once when a web font finishes loading,
 * since a still figure otherwise keeps the fallback font it first drew with.
 * Hosts without these APIs (bare Node) get no watching. Returns a teardown.
 */
export function watchVisibility(canvas: HTMLCanvasElement, runtime: Sleeper): () => void {
  const observer = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver((entries) => {
    const onScreen = entries.at(-1)?.isIntersecting;
    if (onScreen === true) runtime.resume();
    else if (onScreen === false) runtime.suspend();
  }, { rootMargin: "200px" });
  observer?.observe(canvas);
  // A resized canvas (rotation, a narrower pane) redraws, so over-canvas inputs resize with it.
  const resized = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => runtime.invalidate());
  resized?.observe(canvas);
  const fonts = typeof document === "undefined" ? undefined : document.fonts;
  const redraw = (): void => runtime.fontsLoaded();
  fonts?.addEventListener("loadingdone", redraw);
  return () => {
    observer?.disconnect();
    resized?.disconnect();
    fonts?.removeEventListener("loadingdone", redraw);
  };
}
