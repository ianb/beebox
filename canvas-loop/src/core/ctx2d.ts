// The structural 2D-context subset the colour parsers and the text measurer
// use a real context through. Internal: no sketch sees a context.

/** Horizontal text alignment — mirrors the (unexported) `CanvasTextAlign`. */
export type CtxTextAlign = "center" | "end" | "left" | "right" | "start";
/** Text baseline — mirrors the (unexported) `CanvasTextBaseline`. */
export type CtxTextBaseline = "alphabetic" | "bottom" | "hanging" | "ideographic" | "middle" | "top";

/** A gradient handle as both contexts expose it — the one shared method is `addColorStop`. */
export interface Ctx2DGradient {
  addColorStop(offset: number, color: string): void;
}

/**
 * An offscreen surface's image, as `drawImage` accepts it. Opaque: each runtime
 * hands its real canvas through one boundary cast in its `makeLayer` factory.
 */
export interface LayerImage {
  readonly layerImageBrand: never;
}

/** An offscreen drawing surface: a context to draw on and the image to composite. */
export interface Layer {
  readonly ctx: Ctx2D;
  readonly image: LayerImage;
}

/** Make an offscreen layer of the given device-pixel size (runtime-specific). */
export type MakeLayer = (size: { width: number; height: number }) => Layer;

/** A 2D affine transform, `[a b c d e f]` as Canvas2D reports it. */
export interface CtxTransform {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

/** Pixel data from `createImageData`. */
export interface CtxImageData {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** The exact 2D-context surface the drawing engine uses. */
export interface Ctx2D {
  fillStyle: string | Ctx2DGradient;
  strokeStyle: string | Ctx2DGradient;
  lineWidth: number;
  lineCap: "butt" | "round" | "square";
  lineJoin: "bevel" | "miter" | "round";
  globalAlpha: number;
  globalCompositeOperation: string;
  /** A CSS filter list applied to later drawing ("none" for none). */
  filter: string;
  font: string;
  textAlign: CtxTextAlign;
  textBaseline: CtxTextBaseline;
  save(): void;
  restore(): void;
  resetTransform(): void;
  getTransform(): CtxTransform;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  drawImage(image: LayerImage, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
  createImageData(width: number, height: number): CtxImageData;
  getImageData(x: number, y: number, w: number, h: number): CtxImageData;
  putImageData(imageData: CtxImageData, dx: number, dy: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  ellipse(x: number, y: number, radiusX: number, radiusY: number, rotation: number, startAngle: number, endAngle: number): void;
  fill(): void;
  stroke(): void;
  clip(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  setLineDash(segments: number[]): void;
  measureText(text: string): { readonly width: number; readonly alphabeticBaseline: number };
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): Ctx2DGradient;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): Ctx2DGradient;
}
