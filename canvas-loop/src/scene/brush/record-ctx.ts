// A Ctx2D that records what canvas-loop's brush kinds (core/brush/render/kinds.ts)
// paint instead of rasterising it (the Stage 3 brushes probe): arcs and soft-dab
// images become dabs, filled paths become ink outlines, stroked paths become
// bristle runs. Calls the kinds never make throw, so a change in kinds.ts that
// paints some other way fails loudly instead of drawing nothing.
import type { Ctx2D, Ctx2DGradient, CtxImageData, CtxTextAlign, CtxTextBaseline, CtxTransform, LayerImage } from "../../core/ctx2d.js";
import { GpuRenderError } from "../errors.js";

/** One round dab: centre, radius, alpha; a soft tip fades linearly to its edge. Colour is 0..1, or black coverage. */
export interface Dab {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly a: number;
  readonly soft: boolean;
  readonly rgb: readonly [number, number, number];
}
/** One bristle run: a polyline (flat x, y pairs) of one width and alpha. */
export interface Run {
  readonly pts: readonly number[];
  readonly width: number;
  readonly a: number;
  readonly rgb: readonly [number, number, number];
}

/** The pre-drawn soft dab kinds.ts copies with drawImage: here only a marker. */
export class SoftDabImage implements LayerImage {
  get layerImageBrand(): never {
    throw new GpuRenderError({ detail: "the soft-dab marker has no pixels" });
  }
}

class RecordedGradient implements Ctx2DGradient {
  readonly stops: [number, string][] = [];
  addColorStop(offset: number, color: string): void {
    this.stops.push([offset, color]);
  }
}

const inks = new Map<string, { rgb: readonly [number, number, number]; a: number }>();

/** `rgba(r, g, b, a)` as kinds.ts and ink.ts write it: 0..1 channels and alpha (parsed once per string). */
function parseInk(style: string | Ctx2DGradient): { rgb: readonly [number, number, number]; a: number } {
  const css = style instanceof RecordedGradient ? (style.stops[0]?.[1] ?? "") : style;
  if (typeof css !== "string") throw new GpuRenderError({ detail: "brush recorder: unexpected ink (not a string)" });
  const hit = inks.get(css);
  if (hit !== undefined) return hit;
  const m = /^rgba\(([\d.]+), ([\d.]+), ([\d.]+), ([\d.e-]+)\)$/.exec(css);
  if (m === null) throw new GpuRenderError({ detail: `brush recorder: unexpected ink ${css}` });
  const ink = { rgb: [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255] as const, a: Number(m[4]) };
  if (inks.size < 4096) inks.set(css, ink);
  return ink;
}

function unexpected(call: string): never {
  throw new GpuRenderError({ detail: `brush recorder: kinds.ts called ${call}, which the GPU expansion does not record` });
}

export class RecordingCtx implements Ctx2D {
  globalAlpha = 1;
  fillStyle: string | Ctx2DGradient = "rgba(0, 0, 0, 1)";
  strokeStyle: string | Ctx2DGradient = "rgba(0, 0, 0, 1)";
  lineWidth = 1;
  lineCap: "butt" | "round" | "square" = "butt";
  lineJoin: "bevel" | "miter" | "round" = "round";
  globalCompositeOperation = "source-over";
  filter = "none";
  font = "";
  textAlign: CtxTextAlign = "left";
  textBaseline: CtxTextBaseline = "alphabetic";
  readonly dabs: Dab[] = [];
  readonly polys: number[][] = [];
  readonly runs: Run[] = [];
  #path: number[][] = [];
  #arc: { x: number; y: number; r: number } | undefined;

  beginPath(): void {
    this.#path = [];
    this.#arc = undefined;
  }
  moveTo(x: number, y: number): void {
    this.#path.push([x, y]);
  }
  lineTo(x: number, y: number): void {
    this.#path.at(-1)?.push(x, y);
  }
  closePath(): void {}
  arc(...[x, y, radius]: [number, number, number, number, number]): void {
    this.#arc = { x, y, r: radius };
  }
  fill(): void {
    const arc = this.#arc;
    if (arc !== undefined) {
      const ink = parseInk(this.fillStyle);
      this.dabs.push({ x: arc.x, y: arc.y, r: arc.r, a: this.globalAlpha * ink.a, soft: this.fillStyle instanceof RecordedGradient, rgb: ink.rgb });
      return;
    }
    for (const p of this.#path) if (p.length >= 6) this.polys.push(p);
  }
  stroke(): void {
    const ink = parseInk(this.strokeStyle);
    for (const p of this.#path) if (p.length >= 4) this.runs.push({ pts: p, width: this.lineWidth, a: this.globalAlpha * ink.a, rgb: ink.rgb });
  }
  drawImage(...args: [LayerImage, number, number, number, number, number, number, number, number]): void {
    const [image, , , , , dx, dy, dw] = args;
    if (!(image instanceof SoftDabImage)) unexpected("drawImage of another image");
    const r = dw / 2;
    this.dabs.push({ x: dx + r, y: dy + r, r, a: this.globalAlpha, soft: true, rgb: [0, 0, 0] });
  }
  createRadialGradient(): Ctx2DGradient {
    return new RecordedGradient();
  }
  save(): void {}
  restore(): void {}
  setLineDash(): void {}

  resetTransform(): void {
    unexpected("resetTransform");
  }
  getTransform(): CtxTransform {
    return unexpected("getTransform");
  }
  setTransform(): void {
    unexpected("setTransform");
  }
  createImageData(): CtxImageData {
    return unexpected("createImageData");
  }
  getImageData(): CtxImageData {
    return unexpected("getImageData");
  }
  putImageData(): void {
    unexpected("putImageData");
  }
  clearRect(): void {
    unexpected("clearRect");
  }
  translate(): void {
    unexpected("translate");
  }
  rotate(): void {
    unexpected("rotate");
  }
  scale(): void {
    unexpected("scale");
  }
  quadraticCurveTo(): void {
    unexpected("quadraticCurveTo");
  }
  bezierCurveTo(): void {
    unexpected("bezierCurveTo");
  }
  rect(): void {
    unexpected("rect");
  }
  ellipse(): void {
    unexpected("ellipse");
  }
  clip(): void {
    unexpected("clip");
  }
  fillRect(): void {
    unexpected("fillRect");
  }
  fillText(): void {
    unexpected("fillText");
  }
  strokeText(): void {
    unexpected("strokeText");
  }
  measureText(): { readonly width: number } {
    return unexpected("measureText");
  }
  createLinearGradient(): Ctx2DGradient {
    return unexpected("createLinearGradient");
  }
}
