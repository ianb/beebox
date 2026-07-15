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

import { useEffect, useRef } from "react";
import type { ViewFileHelpers } from "../hooks/useViewFileHelpers";

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
  /** Box file helpers (read/url/write/…), reused from the views system. */
  file: ViewFileHelpers;
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
async function loadRuntimeLib(runtime: FigureRuntime): Promise<unknown> {
  if (runtime === "p5js") {
    const mod = await import("p5");
    return mod.default;
  }
  if (runtime === "three") {
    return import("three");
  }
  if (runtime === "canvas-loop") {
    await import("@ianbicking/canvas-loop/browser/figure.css");
    return import("@ianbicking/canvas-loop/browser");
  }
  return import("d3");
}

interface FigureMountProps {
  runtime: FigureRuntime;
  sketch: FigureSketch;
  figure: FigureContext;
  onError: (message: string) => void;
}

export function FigureMount({ runtime, sketch, figure, onError }: FigureMountProps) {
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
        const lib = await loadRuntimeLib(runtime);
        if (state.cancelled) return;
        teardown = sketch(lib, { mount: el, figure: figureRef.current });
      } catch (e) {
        if (!state.cancelled) onError(e instanceof Error ? e.message : String(e));
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

  return <div ref={mountRef} className="w-full" />;
}
