// The figure canvas in the DOM: its device-pixel sizing, and pointer and key
// input wired into a runtime. Shared by `attachSketch` and the playground.
import type { Runtime } from "./runtime/engine.js";

/**
 * Wire pointer/key listeners on the canvas straight into the runtime's input
 * methods — the same dispatch path scripted events take. Pointer events cover
 * mouse, touch and pen; each reaches the sketch as `mousedown`/`mousemove`/
 * `mouseup`, so sketches and events files are the same for every device.
 * Returns a teardown that removes every listener.
 */
export function wireInput(canvas: HTMLCanvasElement, runtime: Runtime): () => void {
  // A drag that starts on the canvas belongs to the sketch, not to page scrolling.
  canvas.style.touchAction = "none";
  // The one pointer (finger or mouse) that pressed; others are ignored until it lifts.
  let pressedId: number | undefined;
  const send = (type: "mousedown" | "mousemove" | "mouseup", e: PointerEvent): void => {
    const p = coords(canvas, e);
    runtime.pointer({ type, x: p.x, y: p.y });
  };
  const onDown = (e: PointerEvent): void => {
    if (!e.isPrimary || pressedId !== undefined) return;
    runtime.enableSound();
    pressedId = e.pointerId;
    // Keep this pointer's moves and its release even when it slides off the canvas.
    canvas.setPointerCapture(e.pointerId);
    canvas.focus({ preventScroll: true });
    send("mousedown", e);
  };
  // Every move of the primary pointer is sent, pressed or not (as in a scripted
  // events file), so a sketch can react to hover; a finger only moves while down.
  const onMove = (e: PointerEvent): void => {
    if (!e.isPrimary || (pressedId !== undefined && e.pointerId !== pressedId)) return;
    send("mousemove", e);
  };
  // A lift, a cancel (the browser took the touch) and a lost capture all end the press once.
  const release = (e: PointerEvent): void => {
    // iOS unlocks audio on a touch's end, not its start, so a lift asks too.
    if (e.type === "pointerup") runtime.enableSound();
    if (e.pointerId !== pressedId) return;
    pressedId = undefined;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    send("mouseup", e);
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    runtime.enableSound();
    if (e.key.startsWith("Arrow")) e.preventDefault();
    runtime.key({ type: "keydown", key: e.key });
  };
  const onKeyUp = (e: KeyboardEvent): void => runtime.key({ type: "keyup", key: e.key });
  const listeners = [
    ["pointerdown", onDown],
    ["pointermove", onMove],
    ["pointerup", release],
    ["pointercancel", release],
    ["lostpointercapture", release],
  ] as const;
  for (const [type, fn] of listeners) canvas.addEventListener(type, fn);
  canvas.addEventListener("keydown", onKeyDown);
  canvas.addEventListener("keyup", onKeyUp);
  return () => {
    for (const [type, fn] of listeners) canvas.removeEventListener(type, fn);
    canvas.removeEventListener("keydown", onKeyDown);
    canvas.removeEventListener("keyup", onKeyUp);
  };
}

/** CSS→canvas coordinate mapping for a pointer event (accounts for display scaling). */
/**
 * Size a canvas for the screen's pixel density: `size` logical pixels shown at
 * that size, backed by `size × devicePixelRatio` device pixels, so drawing is
 * sharp on a high-density display. The ratio is kept on the element.
 */
export function sizeCanvas(canvas: HTMLCanvasElement, size: { width: number; height: number }): void {
  setDensity(canvas, size);
  canvas.style.width = `${size.width}px`;
}

/** Give a canvas a backing store of `size × devicePixelRatio` device pixels (its display size is left alone). */
export function setDensity(canvas: HTMLCanvasElement, size: { width: number; height: number }): void {
  // No devicePixelRatio (a non-browser host) means 1; very dense screens are capped at 3.
  const dpr = Number(globalThis.devicePixelRatio);
  // Capped at 2: on a 3× phone screen 3× is barely sharper and costs 2.25× the pixels.
  const ratio = Number.isFinite(dpr) && dpr > 0 ? Math.min(2, Math.max(1, dpr)) : 1;
  canvas.width = Math.round(size.width * ratio);
  canvas.height = Math.round(size.height * ratio);
  RATIOS.set(canvas, ratio);
}

// The pixel ratio each canvas was sized with (kept off the DOM).
const RATIOS = new WeakMap<HTMLCanvasElement, number>();

/** The pixel ratio `sizeCanvas` gave a canvas (1 for a canvas it did not size). */
export function pixelRatioOf(canvas: HTMLCanvasElement): number {
  return RATIOS.get(canvas) ?? 1;
}

function coords(canvas: HTMLCanvasElement, e: MouseEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  // In logical (sketch) pixels: the backing store is pixelRatio times larger.
  const ratio = pixelRatioOf(canvas);
  const sx = rect.width === 0 ? 1 : canvas.width / ratio / rect.width;
  const sy = rect.height === 0 ? 1 : canvas.height / ratio / rect.height;
  return { x: Math.round((e.clientX - rect.left) * sx), y: Math.round((e.clientY - rect.top) * sy) };
}
