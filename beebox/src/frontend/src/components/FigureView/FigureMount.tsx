/**
 * Per-runtime mount harness for figure sketches.
 *
 * A figure's compiled module default-exports a `(lib, mount, figure) =>
 * teardown` factory. This component lazily imports the runtime library
 * (p5/three/d3/canvas-loop), hands it to the factory along with a mount
 * element and the figure context, and runs the returned teardown on unmount.
 * The lazy import keeps each runtime in its own Vite chunk and off the SSR
 * path (p5 touches `window` at import time).
 */

import { errorMessage } from "@shared/error-guards";
import { useEffect, useRef } from "react";
import type { ViewFileHelpers } from "../../hooks/useViewFileHelpers";
import type { FigureParamDecl } from "../../lib/figure-params";
import { wrapCanvasLoopLib, type FigureActivityLog, type FigureActivityReporter } from "../../lib/figure-canvas-loop";

export type FigureRuntime = "p5js" | "three" | "d3" | "canvas-loop";

/**
 * Optional cleanup returned by a sketch — required for runtimes that hold
 * resources (p5 `.remove()`, three RAF + disposal, d3 listeners).
 */
export type FigureTeardown = (() => void) | void;

/** Context handed to every figure sketch. */
export interface FigureContext {
  /** Embed query params, coerced to each param's declared type. */
  params: Record<string, string | number | boolean>;
  /** The card's free-form `data` field. */
  data: Record<string, unknown>;
  /** The card's validated frontmatter. */
  meta: Record<string, unknown>;
  /**
   * Read-only box file helpers. Figures cannot write, commit or call
   * connected services; a figure that must save lives inside a view.
   */
  file: FigureFileHelpers;
}

/** The read half of the views' file helpers: what a figure may use. */
export type FigureFileHelpers = Pick<ViewFileHelpers, "readFile" | "fileUrl" | "imageUrl">;

/** Pick the read helpers, so the figure object never carries a write function. */
export function figureFileHelpers(helpers: ViewFileHelpers): FigureFileHelpers {
  return { readFile: helpers.readFile, fileUrl: helpers.fileUrl, imageUrl: helpers.imageUrl };
}

/**
 * The default export of a figure's compiled entry module. The library is the
 * prominent first argument (sketches think "p5 + where to draw"); the mount
 * element and figure context travel together in a second object argument (the
 * codebase caps positional params at two).
 */
export type FigureSketch = (
  lib: unknown,
  ctx: { mount: HTMLElement; figure: FigureContext },
) => FigureTeardown;

/**
 * Lazily load the runtime library a sketch is handed as `lib`. Each `import()`
 * becomes its own Vite chunk, loaded only when a figure of that runtime first
 * renders. p5 hands over its default-exported constructor; three and d3 hand
 * over their module namespace (`new lib.Scene()`, `lib.select(mount)`);
 * canvas-loop hands over its browser-API namespace (`lib.mountSketch(...)` —
 * a linked workspace subpath Vite serves as source, see vite.config.ts
 * `optimizeDeps`) plus its stylesheet (real CSS import, not a runtime <style>,
 * so the prod CSP's style-src stays clean).
 */
async function loadRuntimeLib(runtime: FigureRuntime, harness: CanvasLoopHarness): Promise<unknown> {
  if (runtime === "p5js") {
    const mod = await import("p5");
    return mod.default;
  }
  if (runtime === "three") {
    return import("three");
  }
  if (runtime === "canvas-loop") {
    await import("@ianbicking/canvas-loop/browser/figure.css");
    return wrapCanvasLoopLib(await import("@ianbicking/canvas-loop/browser"), harness);
  }
  return import("d3");
}

/** What the canvas-loop `mountSketch` wrapper adds for this figure (`lib/figure-canvas-loop.ts`). */
interface CanvasLoopHarness {
  declared: readonly FigureParamDecl[];
  reportActivity?: FigureActivityReporter;
  activityLog?: FigureActivityLog;
}

interface FigureMountProps {
  runtime: FigureRuntime;
  sketch: FigureSketch;
  figure: FigureContext;
  onError: (message: string) => void;
  /** The card's declared `params:`, checked against a canvas-loop module's own. Default none. */
  declaredParams?: readonly FigureParamDecl[];
  /** Companion-pane activity for this card; absent elsewhere. */
  reportActivity?: FigureActivityReporter;
  /** Where this figure's actions are logged; absent outside the companion pane. */
  activityLog?: FigureActivityLog;
}

export function FigureMount({ runtime, sketch, figure, onError, declaredParams, reportActivity, activityLog }: FigureMountProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  // Hold the latest figure context in a ref so the mount effect can read it at
  // mount time without taking it as a dependency — rebuilding the context object
  // each render must not remount the sketch. (Embed-param changes will remount
  // deliberately, via Track 4.) The ref is updated in an effect, never during
  // render.
  const figureRef = useRef(figure);
  useEffect(() => {
    figureRef.current = figure;
  }, [figure]);
  // Same pattern for the mount-time harness inputs: a new reporter or param
  // list identity must not remount the sketch. The reporter is called through
  // the ref, so a re-bound reporter takes effect without a remount.
  const harnessRef = useRef({ declaredParams, reportActivity, activityLog });
  useEffect(() => {
    harnessRef.current = { declaredParams, reportActivity, activityLog };
  }, [declaredParams, reportActivity, activityLog]);

  useEffect(() => {
    const el = mountRef.current;
    if (el === null) return;
    let teardown: FigureTeardown;
    // A plain boolean would get narrowed to its literal `false` at the read
    // sites below — TS's flow analysis can't see that the cleanup closure
    // (a separate function) may flip it before the async load resolves. A
    // mutable object property isn't narrowed the same way, which also keeps
    // the check honest for readers.
    const state = { cancelled: false };

    void (async () => {
      try {
        const { declaredParams: declared, reportActivity: reporter, activityLog: log } = harnessRef.current;
        const lib = await loadRuntimeLib(runtime, {
          declared: declared ?? [],
          ...(reporter !== undefined ? { reportActivity: (kind, detail) => { harnessRef.current.reportActivity?.(kind, detail); } } : {}),
          ...(log !== undefined ? { activityLog: { ...log, push: (report) => { harnessRef.current.activityLog?.push(report); } } } : {}),
        });
        if (state.cancelled) return;
        teardown = sketch(lib, { mount: el, figure: figureRef.current });
        // Legacy backstop: an <svg> without a viewBox *crops* instead of
        // scaling under the CSS max-width below, so patch one in from its
        // width/height attributes. New sketches (d3 guidance) carry their own
        // viewBox already, so this only fires for older, fixed-size sketches.
        for (const svg of el.querySelectorAll("svg:not([viewBox])")) {
          const w = Number(svg.getAttribute("width"));
          const h = Number(svg.getAttribute("height"));
          if (w > 0 && h > 0) svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
        }
      } catch (e) {
        if (!state.cancelled) onError(errorMessage(e));
      }
    })();

    return () => {
      state.cancelled = true;
      if (typeof teardown === "function") {
        try {
          teardown();
        } catch (e) {
          // A failing teardown must not crash the unmount; log so a resource
          // leak is visible rather than silent.
          console.error("figure teardown failed", e);
        }
      }
      // Clear anything the sketch appended so a remount (including StrictMode's
      // dev double-invoke) starts from a clean element.
      el.replaceChildren();
    };
  }, [runtime, sketch, onError]);

  // max-width/height:auto caps any descendant canvas/svg/input at the mount's
  // width while preserving intrinsic aspect ratio, so a fixed-size sketch
  // scales down instead of overflowing its column. The `!` (important) is
  // load-bearing: p5 writes inline `width`/`height` styles on its canvas, and
  // plain classes lose to those — height would stay fixed while max-width
  // shrank the canvas, distorting the aspect ratio. Safe for p5 interactions:
  // p5 2.3.0's `_updatePointerCoords` divides pointer coordinates by
  // `canvas.scrollWidth / this.width`, compensating for CSS scaling — re-
  // verify this on any p5 major bump.
  return (
    <div
      ref={mountRef}
      className="bbx-figure-mount w-full [&_canvas]:!max-w-full [&_canvas]:!h-auto [&_svg]:!max-w-full [&_svg]:!h-auto [&_input]:!max-w-full"
    />
  );
}
