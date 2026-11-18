// The file-room sketch as the public site's page background: one fixed canvas
// behind the paper card, drawn at ratio 1 (the scene is large and soft, and
// four times the pixels is too slow), moved with the reading pane's scroll.
// The site's loader (site/room.ts) imports this bundle after the page has
// loaded and calls `mountFileRoom`.
import * as fileRoom from "../site/file-room-tea.js";
import { attachSketch, coerceModule } from "./mount.js";

const SEED = 1;
/** After `ready`, this many milliseconds of visible time are measured. */
const WATCH_MS = 5000;
/** Fewer frames than this in that time (20 fps) and the scene is removed. */
const MIN_FRAMES = 100;

/** The mounted background: `place` re-reads the reading pane's scroll, `teardown` (idempotent) removes it. */
export interface MountedRoom {
  place: () => void;
  teardown: () => void;
}

/**
 * Put the file-room animation behind the page. The teardown removes the canvas
 * and the `data-site-room` mark. A figure that fails, loses its GPU device or
 * runs under 20 fps tears itself down the same way.
 */
export function mountFileRoom(): MountedRoom {
  const module = coerceModule(fileRoom);
  const size = module.canvas ?? { width: 1600, height: 2400 };
  const canvas = document.createElement("canvas");
  canvas.className = "site-room";
  canvas.setAttribute("aria-hidden", "true");
  // Not sizeCanvas: that multiplies by devicePixelRatio. An unsized canvas has pixel ratio 1.
  canvas.width = size.width;
  canvas.height = size.height;
  const workspace = document.querySelector("#site-workspace");
  document.body.insertBefore(canvas, workspace);

  let done = false;
  let frames = 0;
  let measuring = false;
  let wasHidden = false;
  let visibleMs = 0;
  let lastTick = performance.now();
  let raf = 0;
  let watchdog = 0;

  const place = (): void => {
    raf = 0;
    const pane = document.querySelector("#reading-card");
    const fraction = pane === null ? 0 : pane.scrollTop / Math.max(1, pane.scrollHeight - pane.clientHeight);
    const canvasHeight = (window.innerWidth * size.height) / size.width;
    const travel = Math.max(0, canvasHeight - window.innerHeight);
    canvas.style.transform = `translateY(${-Math.min(1, Math.max(0, fraction)) * travel}px)`;
  };
  const schedule = (): void => {
    if (raf === 0 && !done) raf = requestAnimationFrame(place);
  };

  const attached = attachSketch(canvas, {
    module,
    seed: SEED,
    paused: false,
    onFrame: () => {
      if (measuring) frames += 1;
    },
    onError: (error) => {
      console.warn("site background: the file-room animation failed and was removed", error);
      teardown();
    },
    // A lost device would leave a dead canvas over the page's own background.
    onNotice: (message) => {
      if (message !== undefined) teardown();
    },
  });

  // A hidden tab neither draws nor counts: the measurement starts over once the tab is visible again.
  const noteHidden = (): void => {
    if (document.visibilityState !== "visible") wasHidden = true;
  };
  const tick = (): void => {
    const now = performance.now();
    if (wasHidden || document.visibilityState !== "visible") {
      wasHidden = document.visibilityState !== "visible";
      frames = 0;
      visibleMs = 0;
      lastTick = now;
      return;
    }
    visibleMs += now - lastTick;
    lastTick = now;
    if (visibleMs >= WATCH_MS) {
      clearInterval(watchdog);
      if (frames < MIN_FRAMES) teardown();
    }
  };

  function teardown(): void {
    if (done) return;
    done = true;
    clearInterval(watchdog);
    if (raf !== 0) cancelAnimationFrame(raf);
    document.removeEventListener("visibilitychange", noteHidden);
    document.removeEventListener("scroll", schedule, { capture: true });
    window.removeEventListener("resize", schedule);
    attached.teardown();
    canvas.remove();
    delete document.body.dataset["siteRoom"];
  }

  document.addEventListener("visibilitychange", noteHidden);
  document.addEventListener("scroll", schedule, { capture: true, passive: true });
  window.addEventListener("resize", schedule);
  place();

  void attached.ready.then(() => {
    if (done) return;
    canvas.classList.add("on");
    document.body.dataset["siteRoom"] = "on";
    frames = 0;
    measuring = true;
    lastTick = performance.now();
    watchdog = window.setInterval(tick, 250);
  });
  return { place: schedule, teardown };
}
