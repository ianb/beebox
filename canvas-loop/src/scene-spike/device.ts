// One way to get a GPU device in either runtime: the browser's `navigator.gpu`,
// or Dawn (the `webgpu` package) in Node. Dawn's GPU object must stay
// referenced for as long as its devices live (collecting it crashes the
// process), so it is kept at module level.
import type { create as CreateDawn } from "webgpu";
import type { Ctx2D, LayerImage } from "../core/paint.js";
import { TextMeasurer } from "../core/painter/text/measure.js";
import { GpuRenderError } from "./errors.js";
import type { ColorParser } from "./colors.js";
import { colorsFrom } from "./colors.js";

/** The part of a runtime 2D canvas context that rasterises glyphs (napi-rs canvas headless, OffscreenCanvas in a browser). */
export interface RasterCtx {
  font: string;
  textBaseline: string;
  textAlign: string;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineJoin: string;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  measureText(text: string): { readonly actualBoundingBoxLeft: number; readonly actualBoundingBoxRight: number; readonly actualBoundingBoxAscent: number; readonly actualBoundingBoxDescent: number };
  getImageData(x: number, y: number, w: number, h: number): { readonly data: Uint8ClampedArray };
}
/** A fresh 2D context of at least this size, for glyphs. */
export type MakeRaster = (size: { width: number; height: number }) => RasterCtx;

/** A device and what the renderer needs beside it. */
export interface GpuHandle {
  readonly device: GPUDevice;
  /** The coverage atlas format: r32float when the device can blend it, else r16float. */
  readonly atlasFormat: "r32float" | "r16float";
  /** CSS colours, parsed as the runtime's 2D canvas parses them. */
  readonly colors: ColorParser;
  /** 2D contexts for the glyph atlas: the runtime's own text rasteriser. */
  readonly raster: MakeRaster;
  /** The adapter, for transcripts. */
  readonly description: string;
  destroy(): void;
}

let dawn: GPU | undefined;

function isGpu(x: unknown): x is GPU {
  return typeof x === "object" && x !== null && typeof Reflect.get(x, "requestAdapter") === "function";
}

async function gpuEntry(): Promise<{ gpu: GPU; node: boolean }> {
  const nav: unknown = Reflect.get(globalThis, "navigator");
  const browserGpu: unknown = typeof nav === "object" && nav !== null ? Reflect.get(nav, "gpu") : undefined;
  if (isGpu(browserGpu)) return { gpu: browserGpu, node: false };
  const mod: { create: typeof CreateDawn; globals: object } = await import("webgpu");
  Object.assign(globalThis, mod.globals);
  dawn ??= mod.create([]);
  return { gpu: dawn, node: true };
}

async function node2d(): Promise<Ctx2D> {
  const { createCanvas } = await import("@napi-rs/canvas");
  // eslint-disable-next-line no-restricted-syntax -- structural-context boundary: SKRSContext2D is a superset of Ctx2D (wider fillStyle union), as in headless/surface.ts
  return createCanvas(1, 1).getContext("2d") as unknown as Ctx2D;
}

async function nodeRaster(): Promise<MakeRaster> {
  const { createCanvas } = await import("@napi-rs/canvas");
  return (size) => createCanvas(size.width, size.height).getContext("2d");
}

function isRasterCtx(x: unknown): x is RasterCtx {
  return typeof x === "object" && x !== null && ["fillText", "strokeText", "measureText", "getImageData"].every((k) => typeof Reflect.get(x, k) === "function");
}

function browserRaster(): MakeRaster {
  const Offscreen: unknown = Reflect.get(globalThis, "OffscreenCanvas");
  if (typeof Offscreen !== "function") throw new GpuRenderError({ detail: "no OffscreenCanvas to draw glyphs with" });
  return (size) => {
    const canvas: unknown = Reflect.construct(Offscreen, [size.width, size.height]);
    const getContext: unknown = typeof canvas === "object" && canvas !== null ? Reflect.get(canvas, "getContext") : undefined;
    const ctx: unknown = typeof getContext === "function" ? Reflect.apply(getContext, canvas, ["2d", { willReadFrequently: true }]) : undefined;
    if (!isRasterCtx(ctx)) throw new GpuRenderError({ detail: "OffscreenCanvas gave no 2D context" });
    return ctx;
  };
}

function browser2d(): Ctx2D {
  const Offscreen: unknown = Reflect.get(globalThis, "OffscreenCanvas");
  if (typeof Offscreen !== "function") throw new GpuRenderError({ detail: "no OffscreenCanvas for colours and text" });
  const canvas: unknown = Reflect.construct(Offscreen, [1, 1]);
  const getContext: unknown = typeof canvas === "object" && canvas !== null ? Reflect.get(canvas, "getContext") : undefined;
  if (typeof getContext !== "function") throw new GpuRenderError({ detail: "OffscreenCanvas has no getContext" });
  // eslint-disable-next-line no-restricted-syntax -- runtime boundary: the browser's 2D context satisfies the structural Ctx2D, as the browser runtime's makeLayer does
  return Reflect.apply(getContext, canvas, ["2d"]) as Ctx2D;
}

/** A 2D context of the runtime: napi-rs canvas in Node, an OffscreenCanvas in a browser. */
async function runtime2d(): Promise<Ctx2D> {
  const nav: unknown = Reflect.get(globalThis, "navigator");
  const browser = typeof nav === "object" && nav !== null && typeof Reflect.get(globalThis, "OffscreenCanvas") === "function";
  return browser ? browser2d() : node2d();
}

class NoImage implements LayerImage {
  get layerImageBrand(): never {
    throw new GpuRenderError({ detail: "a measuring layer has no image" });
  }
}

/** Today's text measurer over one of the runtime's 2D contexts: what the recorder lays text out with (draft section 7). */
export async function openTextMeasurer(): Promise<TextMeasurer> {
  const ctx = await runtime2d();
  const image = new NoImage();
  return new TextMeasurer(() => ({ ctx, image }));
}

/** A GPU device, or undefined when the runtime has no adapter (a machine without a GPU and without a software fallback). */
export async function openGpu(): Promise<GpuHandle | undefined> {
  const { gpu, node } = await gpuEntry();
  const adapter = await gpu.requestAdapter();
  if (adapter === null) return undefined;
  const blendable = adapter.features.has("float32-blendable");
  const device = await adapter.requestDevice({ requiredFeatures: blendable ? ["float32-blendable"] : [] });
  const info = adapter.info;
  return {
    device,
    atlasFormat: blendable ? "r32float" : "r16float",
    colors: colorsFrom(node ? await node2d() : browser2d()),
    raster: node ? await nodeRaster() : browserRaster(),
    description: [info.vendor, info.architecture, info.description].filter((s) => s !== "").join(" ") || "unknown adapter",
    destroy: () => device.destroy(),
  };
}
