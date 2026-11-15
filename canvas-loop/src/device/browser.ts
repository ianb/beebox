// Opening the GPU in a browser, with none of `open.ts`'s Node paths
// (Dawn, napi-rs canvas), so a browser bundle pulls in neither. `open.ts`
// reuses the adapter step (`openOn`) and the OffscreenCanvas contexts.
import type { Ctx2D, LayerImage } from "../core/paint.js";
import { TextMeasurer } from "../core/text/measure.js";
import type { ColorParser } from "../scene/colors.js";
import { colorsFrom } from "../scene/colors.js";
import type { GpuHandle, MakeRaster, RasterCtx } from "./open.js";
import { GpuRenderError } from "../scene/errors.js";

function isRasterCtx(x: unknown): x is RasterCtx {
  return typeof x === "object" && x !== null && ["fillText", "strokeText", "measureText", "getImageData"].every((k) => typeof Reflect.get(x, k) === "function");
}

export function browserRaster(): MakeRaster {
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

export function browser2d(): Ctx2D {
  const Offscreen: unknown = Reflect.get(globalThis, "OffscreenCanvas");
  if (typeof Offscreen !== "function") throw new GpuRenderError({ detail: "no OffscreenCanvas for colours and text" });
  const canvas: unknown = Reflect.construct(Offscreen, [1, 1]);
  const getContext: unknown = typeof canvas === "object" && canvas !== null ? Reflect.get(canvas, "getContext") : undefined;
  if (typeof getContext !== "function") throw new GpuRenderError({ detail: "OffscreenCanvas has no getContext" });
  // eslint-disable-next-line no-restricted-syntax -- runtime boundary: the browser's 2D context satisfies the structural Ctx2D, as the browser runtime's makeLayer does
  return Reflect.apply(getContext, canvas, ["2d"]) as Ctx2D;
}

export class NoImage implements LayerImage {
  get layerImageBrand(): never {
    throw new GpuRenderError({ detail: "a measuring layer has no image" });
  }
}

/** The adapter and device on `gpu`, with what the renderer needs beside them; undefined without an adapter. */
export async function openOn(gpu: GPU, env: { colors: ColorParser; raster: MakeRaster; timestamps: boolean }): Promise<GpuHandle | undefined> {
  const adapter = await gpu.requestAdapter();
  if (adapter === null) return undefined;
  const blendable = adapter.features.has("float32-blendable");
  const timestamps = env.timestamps && adapter.features.has("timestamp-query");
  const features: GPUFeatureName[] = [...(blendable ? ["float32-blendable" as const] : []), ...(timestamps ? ["timestamp-query" as const] : [])];
  const device = await adapter.requestDevice({ requiredFeatures: features });
  const info = adapter.info;
  return {
    device,
    atlasFormat: blendable ? "r32float" : "r16float",
    timestamps,
    colors: env.colors,
    raster: env.raster,
    description: [info.vendor, info.architecture, info.description].filter((s) => s !== "").join(" ") || "unknown adapter",
    destroy: () => device.destroy(),
  };
}

/** The browser's device (`navigator.gpu`), or undefined without WebGPU or an adapter. */
export async function openBrowserGpu(): Promise<GpuHandle | undefined> {
  const nav: unknown = Reflect.get(globalThis, "navigator");
  const gpu: unknown = typeof nav === "object" && nav !== null ? Reflect.get(nav, "gpu") : undefined;
  if (typeof gpu !== "object" || gpu === null || typeof Reflect.get(gpu, "requestAdapter") !== "function") return undefined;
  // eslint-disable-next-line no-restricted-syntax -- runtime boundary: navigator.gpu, checked for requestAdapter above
  return openOn(gpu as GPU, { colors: colorsFrom(browser2d()), raster: browserRaster(), timestamps: false });
}

/** Today's text measurer over an OffscreenCanvas: what the recorder lays text out with (draft section 7). */
export function browserTextMeasurer(): TextMeasurer {
  const ctx = browser2d();
  const image = new NoImage();
  return new TextMeasurer(() => ({ ctx, image }));
}
