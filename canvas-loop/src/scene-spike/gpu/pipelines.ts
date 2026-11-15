// Render pipelines and bind group layouts for drawing and effects, made once per device.
import { DRAW_WGSL } from "./shader-draw.js";
import { FX_WGSL } from "./shader-fx.js";

export type DrawPipe = "normal" | "add" | "screen" | "erase" | "backdrop" | "clipCov" | "clipMul";
export type FxPipe = "fxBlur" | "fxMatrix" | "fxCombine";

export interface Pipelines {
  readonly draw: Readonly<Record<DrawPipe, GPURenderPipeline>>;
  readonly fx: Readonly<Record<FxPipe, GPURenderPipeline>>;
  /** Draw records, gradient stops, clip edges. */
  readonly g0: GPUBindGroupLayout;
  /** Source layer, mask layer, clip mask, backdrop copy, coverage atlas, mark or glyph page, image. */
  readonly g1: GPUBindGroupLayout;
  /** Effect records and blur kernels. */
  readonly f0: GPUBindGroupLayout;
  /** Up to three input layers. */
  readonly f1: GPUBindGroupLayout;
  /** A 1×1 texture bound where a draw has no source. */
  readonly dummy: GPUTexture;
}

function blendOf(colour: readonly [GPUBlendFactor, GPUBlendFactor], alpha?: readonly [GPUBlendFactor, GPUBlendFactor]): GPUBlendState {
  const [src, dst] = colour;
  const [srcA, dstA] = alpha ?? colour;
  return { color: { srcFactor: src, dstFactor: dst, operation: "add" }, alpha: { srcFactor: srcA, dstFactor: dstA, operation: "add" } };
}

export function makePipelines(device: GPUDevice): Pipelines {
  const tex = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } });
  const sto = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } });
  const g0 = device.createBindGroupLayout({ entries: [sto(0), sto(1), sto(2)] });
  const g1 = device.createBindGroupLayout({ entries: [0, 1, 2, 3, 4, 5, 6].map((i) => tex(i)) });
  const f0 = device.createBindGroupLayout({ entries: [sto(0), sto(1)] });
  const f1 = device.createBindGroupLayout({ entries: [tex(0), tex(1), tex(2)] });
  const drawLayout = device.createPipelineLayout({ bindGroupLayouts: [g0, g1] });
  const fxLayout = device.createPipelineLayout({ bindGroupLayouts: [f0, f1] });
  const drawModule = device.createShaderModule({ code: DRAW_WGSL });
  const fxModule = device.createShaderModule({ code: FX_WGSL });
  const mk = (fs: string, target: GPUColorTargetState): GPURenderPipeline =>
    device.createRenderPipeline({ layout: drawLayout, vertex: { module: drawModule, entryPoint: "vs" }, fragment: { module: drawModule, entryPoint: fs, targets: [target] } });
  const rgba = (blend?: GPUBlendState): GPUColorTargetState => ({ format: "rgba8unorm", ...(blend === undefined ? {} : { blend }) });
  const draw: Record<DrawPipe, GPURenderPipeline> = {
    normal: mk("fsFixed", rgba(blendOf(["one", "one-minus-src-alpha"]))),
    add: mk("fsFixed", rgba(blendOf(["one", "one"]))),
    screen: mk("fsFixed", rgba(blendOf(["one-minus-dst", "one"], ["one-minus-dst-alpha", "one"]))),
    erase: mk("fsFixed", rgba(blendOf(["zero", "one-minus-src-alpha"]))),
    backdrop: mk("fsBackdrop", rgba()),
    clipCov: mk("fsClipCov", { format: "r8unorm" }),
    clipMul: mk("fsClipMul", { format: "r8unorm", blend: blendOf(["zero", "src"]) }),
  };
  const fxPipe = (entryPoint: FxPipe): GPURenderPipeline =>
    device.createRenderPipeline({ layout: fxLayout, vertex: { module: fxModule, entryPoint: "fxVs" }, fragment: { module: fxModule, entryPoint, targets: [{ format: "rgba8unorm" }] } });
  const fx: Record<FxPipe, GPURenderPipeline> = { fxBlur: fxPipe("fxBlur"), fxMatrix: fxPipe("fxMatrix"), fxCombine: fxPipe("fxCombine") };
  const dummy = device.createTexture({ size: [1, 1], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING });
  return { draw, fx, g0, g1, f0, f1, dummy };
}
