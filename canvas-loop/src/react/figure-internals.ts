// Non-JSX helpers for <SketchFigure>: value resolution and the display-size
// math. The DOM-facing lifecycle pieces (runtime attach, input wiring, default
// canvas size) live in browser/mount.ts, shared with the imperative
// `mountSketch`; the figure stylesheet is browser/figure.css, imported by the
// consumer (no runtime <style> injection — CSP). Nothing here runs at import
// time, so importing this module is SSR-safe.
import type { CanvasSize, ParamsDecl, ParamValues } from "../core/tea.js";
import type { ParamOverrides } from "../../browser/runtime.js";

/** The value record a host reads/writes: one entry per non-trigger param. */
export type ParamRecord = ParamOverrides;

/** Resolve a declaration + partial overrides into the full value record controls render from. */
export function resolveValues(deps: { decl: ParamsDecl; overrides: ParamRecord | undefined }): ParamValues<ParamsDecl> {
  const out: Record<string, number | boolean | string> = {};
  for (const [name, param] of Object.entries(deps.decl)) {
    if (param.type === "trigger") continue;
    const override = deps.overrides?.[name];
    out[name] = override ?? param.default;
  }
  return out;
}

/** The display (CSS-pixel) size of the canvas given the scale/height props. */
export function displaySize(deps: { canvas: CanvasSize; scale: number | undefined; height: number | undefined }): { width: number; height: number } {
  const factor = deps.scale ?? (deps.height !== undefined ? deps.height / deps.canvas.height : 1);
  return { width: deps.canvas.width * factor, height: deps.canvas.height * factor };
}
