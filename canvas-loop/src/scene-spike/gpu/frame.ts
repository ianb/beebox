// What encoding one frame shares: the command encoder, the texture pool, the
// pipelines, the atlas pages, buffers to free after submit, and counts.
import type { AtlasPage } from "./atlas.js";
import type { Pipelines } from "./pipelines.js";
import type { TexturePool } from "./pool.js";

export interface FrameStats {
  jobs: number;
  pieces: number;
  atlasPages: number;
  passes: number;
  effectPasses: number;
  copies: number;
  draws: number;
}

export interface Frame {
  readonly device: GPUDevice;
  readonly enc: GPUCommandEncoder;
  readonly pool: TexturePool;
  readonly pipes: Pipelines;
  readonly atlas: readonly AtlasPage[];
  /** Buffers made for this frame, destroyed once it is submitted. */
  readonly temp: GPUBuffer[];
  readonly stats: FrameStats;
}

export function emptyStats(): FrameStats {
  return { jobs: 0, pieces: 0, atlasPages: 0, passes: 0, effectPasses: 0, copies: 0, draws: 0 };
}

/** A read-only storage buffer holding `data`, freed after the frame. */
export function storage(f: Frame, data: ArrayBuffer): GPUBuffer {
  const buf = f.device.createBuffer({ size: Math.max(16, data.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  f.device.queue.writeBuffer(buf, 0, data);
  f.temp.push(buf);
  return buf;
}

/** Begin a pass on `tex`, cleared or kept. */
export function beginPass(f: Frame, a: { tex: GPUTexture; clear: boolean }): GPURenderPassEncoder {
  f.stats.passes++;
  return f.enc.beginRenderPass({ colorAttachments: [{ view: a.tex.createView(), loadOp: a.clear ? "clear" : "load", clearValue: [0, 0, 0, 0], storeOp: "store" }] });
}
