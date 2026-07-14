// Non-JSX helpers for <SketchFigure>: value resolution, canvas input wiring, the
// display-size math, and the component's minimal stylesheet. Kept out of the
// .tsx so the component file stays focused on render + lifecycle. Everything
// here is client-only in effect (the DOM types resolve under the react tsconfig)
// but nothing runs at import time, so importing this module is SSR-safe.
import type { CanvasSize, ParamsDecl, ParamValues } from "../core/tea.js";
import type { Runtime } from "../../browser/runtime.js";

/** The value record a host reads/writes: one entry per non-trigger param. */
export type ParamRecord = Readonly<Record<string, number | boolean | string>>;

/** Default drawing surface when a sketch declares no `canvas`. */
export const DEFAULT_CANVAS: CanvasSize = { width: 400, height: 300 };

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

/** CSS→canvas coordinate mapping for a pointer event (accounts for display scaling). */
function coords(canvas: HTMLCanvasElement, e: MouseEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const sx = rect.width === 0 ? 1 : canvas.width / rect.width;
  const sy = rect.height === 0 ? 1 : canvas.height / rect.height;
  return { x: Math.round((e.clientX - rect.left) * sx), y: Math.round((e.clientY - rect.top) * sy) };
}

/** The display (CSS-pixel) size of the canvas given the scale/height props. */
export function displaySize(deps: { canvas: CanvasSize; scale: number | undefined; height: number | undefined }): { width: number; height: number } {
  const factor = deps.scale ?? (deps.height !== undefined ? deps.height / deps.canvas.height : 1);
  return { width: deps.canvas.width * factor, height: deps.canvas.height * factor };
}

/**
 * Wire pointer/key listeners on the canvas straight into the runtime's input
 * methods — the same dispatch path scripted events take. Returns a teardown that
 * removes every listener, so the figure's effect cleanup leaves nothing behind.
 */
export function wireInput(canvas: HTMLCanvasElement, runtime: Runtime): () => void {
  let pressed = false;
  const onDown = (e: MouseEvent): void => {
    pressed = true;
    canvas.focus();
    const p = coords(canvas, e);
    runtime.pointer({ type: "mousedown", x: p.x, y: p.y });
  };
  const onMove = (e: MouseEvent): void => {
    if (!pressed) return;
    const p = coords(canvas, e);
    runtime.pointer({ type: "mousemove", x: p.x, y: p.y });
  };
  const release = (e: MouseEvent): void => {
    if (!pressed) return;
    pressed = false;
    const p = coords(canvas, e);
    runtime.pointer({ type: "mouseup", x: p.x, y: p.y });
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (e.key.startsWith("Arrow")) e.preventDefault();
    runtime.key({ type: "keydown", key: e.key });
  };
  const onKeyUp = (e: KeyboardEvent): void => runtime.key({ type: "keyup", key: e.key });
  canvas.addEventListener("mousedown", onDown);
  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("mouseup", release);
  canvas.addEventListener("mouseleave", release);
  canvas.addEventListener("keydown", onKeyDown);
  canvas.addEventListener("keyup", onKeyUp);
  return () => {
    canvas.removeEventListener("mousedown", onDown);
    canvas.removeEventListener("mousemove", onMove);
    canvas.removeEventListener("mouseup", release);
    canvas.removeEventListener("mouseleave", release);
    canvas.removeEventListener("keydown", onKeyDown);
    canvas.removeEventListener("keyup", onKeyUp);
  };
}

/** The component's minimal stylesheet, rendered once inside each figure (harmlessly deduped by identical rules). */
export const SKETCH_FIGURE_CSS = `
.cl-figure { display: inline-flex; flex-direction: column; gap: 10px; font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #1e293b; }
.cl-figure * { box-sizing: border-box; }
.cl-canvas { display: block; image-rendering: pixelated; outline: none; cursor: crosshair; border-radius: 6px; background: #05070d; }
.cl-canvas:focus { box-shadow: 0 0 0 2px #2563eb; }
.cl-placeholder { border-radius: 6px; background: #0b0e17; }
.cl-toolbar { display: flex; align-items: center; gap: 8px; }
.cl-frame { font-variant-numeric: tabular-nums; color: #64748b; min-width: 72px; }
.cl-btn { background: #eef2ff; color: #1e293b; border: 1px solid #c7d2fe; border-radius: 5px; padding: 3px 10px; cursor: pointer; font: inherit; }
.cl-btn:hover { background: #e0e7ff; }
.cl-params { display: flex; flex-direction: column; gap: 8px; }
.cl-param-row { display: grid; grid-template-columns: 96px 1fr; align-items: center; gap: 10px; }
.cl-param-name { color: #475569; overflow-wrap: anywhere; }
.cl-range-holder { display: flex; align-items: center; gap: 8px; }
.cl-range-holder input { flex: 1; }
.cl-param-value { min-width: 40px; text-align: right; font-variant-numeric: tabular-nums; color: #2563eb; }
.cl-trigger-btn { background: #f3e8ff; color: #6b21a8; border: 1px solid #d8b4fe; border-radius: 5px; padding: 3px 10px; cursor: pointer; font: inherit; }
.cl-muted { color: #94a3b8; font-style: italic; margin: 0; }
.cl-recorder { display: flex; flex-direction: column; gap: 6px; }
.cl-recorder summary { cursor: pointer; color: #2563eb; }
.cl-events { width: 100%; min-width: 260px; background: #05070d; color: #cbd5e1; border: 1px solid #26304a; border-radius: 6px; font: 12px/1.4 ui-monospace, monospace; }
@media (prefers-color-scheme: dark) {
  .cl-figure { color: #e2e8f0; }
  .cl-btn { background: #1e2740; color: #e2e8f0; border-color: #35406a; }
  .cl-btn:hover { background: #27314f; }
  .cl-param-name { color: #cbd5e1; }
  .cl-param-value { color: #93c5fd; }
}
`;
