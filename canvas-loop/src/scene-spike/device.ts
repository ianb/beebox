// One way to get a GPU device in either runtime: the browser's `navigator.gpu`,
// or Dawn (the `webgpu` package) in Node. Dawn's GPU object must stay
// referenced for as long as its devices live (collecting it crashes the
// process), so it is kept at module level.
import type { create as CreateDawn } from "webgpu";
import type { Ctx2D } from "../core/paint.js";
import { GpuRenderError } from "./errors.js";
import type { ColorParser } from "./colors.js";
import { colorsFrom } from "./colors.js";

/** A device and what the renderer needs beside it. */
export interface GpuHandle {
  readonly device: GPUDevice;
  /** The coverage atlas format: r32float when the device can blend it, else r16float. */
  readonly atlasFormat: "r32float" | "r16float";
  /** CSS colours, parsed as the runtime's 2D canvas parses them. */
  readonly colors: ColorParser;
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

async function nodeColors(): Promise<ColorParser> {
  const { createCanvas } = await import("@napi-rs/canvas");
  // eslint-disable-next-line no-restricted-syntax -- structural-context boundary: SKRSContext2D is a superset of Ctx2D (wider fillStyle union), as in headless/surface.ts
  return colorsFrom(createCanvas(1, 1).getContext("2d") as unknown as Ctx2D);
}

function browserColors(): ColorParser {
  const Offscreen: unknown = Reflect.get(globalThis, "OffscreenCanvas");
  if (typeof Offscreen !== "function") throw new GpuRenderError({ detail: "no OffscreenCanvas to parse colours with" });
  const canvas: unknown = Reflect.construct(Offscreen, [1, 1]);
  const getContext: unknown = typeof canvas === "object" && canvas !== null ? Reflect.get(canvas, "getContext") : undefined;
  if (typeof getContext !== "function") throw new GpuRenderError({ detail: "OffscreenCanvas has no getContext" });
  // eslint-disable-next-line no-restricted-syntax -- runtime boundary: the browser's 2D context satisfies the structural Ctx2D, as the browser runtime's makeLayer does
  return colorsFrom(Reflect.apply(getContext, canvas, ["2d"]) as Ctx2D);
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
    colors: node ? await nodeColors() : browserColors(),
    description: [info.vendor, info.architecture, info.description].filter((s) => s !== "").join(" ") || "unknown adapter",
    destroy: () => device.destroy(),
  };
}
