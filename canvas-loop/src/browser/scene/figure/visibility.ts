// Sleep while off screen: what a figure watches to suspend and resume its
// runtime, and to redraw when a web font loads. Split from engine.ts, which
// is at its size limit; the figure starter (start.ts) is its one user.
import type { Runtime } from "../../runtime/engine.js";

/** What `watchVisibility` drives: a runtime, or a figure that also frees its GPU resources while asleep. */
export type Sleeper = Pick<Runtime, "suspend" | "resume" | "invalidate" | "fontsLoaded">;

/**
 * Sleep while off screen: suspend the runtime's loop when the canvas leaves
 * the viewport (with a margin, so it wakes just before it scrolls in) or its
 * tab is hidden, and resume it when both are back. A hidden tab already stops
 * animation frames; counting it as off screen also frees GPU resources.
 * Also redraw once when a web font finishes loading, since a still figure
 * otherwise keeps the fallback font it first drew with.
 * Hosts without these APIs (bare Node) get no watching. Returns a teardown.
 */
export function watchVisibility(canvas: HTMLCanvasElement, runtime: Sleeper): () => void {
  const doc = typeof document === "undefined" ? undefined : document;
  // Unknown until the observer's first report; the tab state is known at once.
  let inView: boolean | undefined;
  let awake = true;
  const update = (): void => {
    if (inView === undefined) return;
    const next = inView && doc?.visibilityState !== "hidden";
    if (next === awake) return;
    awake = next;
    if (next) runtime.resume();
    else runtime.suspend();
  };
  const observer = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver((entries) => {
    const intersecting = entries.at(-1)?.isIntersecting;
    if (intersecting === undefined) return;
    inView = intersecting;
    update();
  }, { rootMargin: "200px" });
  observer?.observe(canvas);
  doc?.addEventListener("visibilitychange", update);
  // A resized canvas (rotation, a narrower pane) redraws, so over-canvas inputs resize with it.
  const resized = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => runtime.invalidate());
  resized?.observe(canvas);
  const fonts = doc?.fonts;
  const redraw = (): void => runtime.fontsLoaded();
  fonts?.addEventListener("loadingdone", redraw);
  return () => {
    observer?.disconnect();
    doc?.removeEventListener("visibilitychange", update);
    resized?.disconnect();
    fonts?.removeEventListener("loadingdone", redraw);
  };
}
