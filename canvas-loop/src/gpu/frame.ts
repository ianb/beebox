// What encoding one frame shares: the command encoder, the texture pool, the
// pipelines, the atlas pages (coverage, marks, glyphs), images, the smear
// pass, buffers to free after submit, and counts.
import type { PixelsVersion } from "../scene/nodes.js";
import type { AtlasPage } from "./atlas.js";
import type { LightPass } from "./light.js";
import type { PainterlyPasses } from "./painterly.js";
import type { PeakBinding } from "./peaks.js";
import type { Pipelines } from "./pipelines.js";
import type { TexturePool } from "./pool.js";
import type { SmearPass } from "./smear.js";
import type { PassKind, PassTimer } from "./timing.js";

export interface FrameStats {
  jobs: number;
  pieces: number;
  atlasPages: number;
  passes: number;
  effectPasses: number;
  copies: number;
  draws: number;
  /** Brushed strokes asked for, expanded afresh, and taken from the expansion cache. */
  strokes: number;
  expanded: number;
  cacheHits: number;
  markPages: number;
  /** Brush pass batches (brush-pass.ts): 0 with no stamp or ink marks, 1 while a frame's brushes fit one batch. */
  brushBatches: number;
  /** Bytes of the frame's one brush sample buffer and output buffer (brush-pass.ts `reserve`), shared by every brush batch and smear. */
  brushScratch: number;
  smears: number;
  glyphs: number;
  /** Kept coverage geometry and linear marks: reused, and made this frame. */
  keptHits: number;
  keptMisses: number;
  /** Picture tiles reused, and drawn this frame. */
  tileHits: number;
  tilesDrawn: number;
  /**
   * CPU milliseconds: lowering the scene, building atlases, encoding jobs,
   * submitting. `brush` is the part of `lower` and `atlas` spent on brushed
   * strokes: preparation and placement at lowering, and the brush pass's
   * packing, upload and encoding in the mark atlas (its draws excluded). A
   * smudge's or wet stroke's brush pass is encoded with its layer and counts
   * in `encode`.
   */
  cpu: { lower: number; atlas: number; encode: number; submit: number; brush: number };
}

export interface Frame {
  readonly device: GPUDevice;
  readonly enc: GPUCommandEncoder;
  readonly pool: TexturePool;
  readonly pipes: Pipelines;
  readonly atlas: readonly AtlasPage[];
  readonly markPages: readonly AtlasPage[];
  readonly glyphPages: readonly AtlasPage[];
  readonly image: (version: PixelsVersion) => GPUTexture;
  readonly smear: SmearPass;
  readonly painterly: PainterlyPasses;
  readonly light: LightPass;
  /** Buffers made for this frame, destroyed once it is submitted. */
  readonly temp: GPUBuffer[];
  readonly stats: FrameStats;
  /** Texture bind groups made this frame, by their textures. */
  readonly bindGroups: Map<string, GPUBindGroup>;
  /** Timestamp queries per pass, when the renderer times passes. */
  readonly timer: PassTimer | undefined;
  /** Testing mode: draws of marks keep their peak alpha (peaks.ts); undefined when not measuring, or with no marks. */
  readonly peaks: PeakBinding | undefined;
}

export function emptyStats(): FrameStats {
  return { jobs: 0, pieces: 0, atlasPages: 0, passes: 0, effectPasses: 0, copies: 0, draws: 0, strokes: 0, expanded: 0, cacheHits: 0, markPages: 0, brushBatches: 0, brushScratch: 0, smears: 0, glyphs: 0, keptHits: 0, keptMisses: 0, tileHits: 0, tilesDrawn: 0, cpu: { lower: 0, atlas: 0, encode: 0, submit: 0, brush: 0 } };
}

/** A read-only storage buffer holding `data`, freed after the frame. */
export function storage(f: Frame, data: ArrayBuffer): GPUBuffer {
  const buf = f.device.createBuffer({ size: Math.max(16, data.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  f.device.queue.writeBuffer(buf, 0, data);
  f.temp.push(buf);
  return buf;
}

/** Timestamp writes for a pass of `kind`, as a pass descriptor's spread; empty when not timing. */
export function timed(f: { readonly timer: PassTimer | undefined }, kind: PassKind): { timestampWrites?: GPURenderPassTimestampWrites } {
  const w = f.timer?.writes(kind);
  return w === undefined ? {} : { timestampWrites: w };
}

/** Begin a pass of `kind` on `tex`, cleared or kept. */
export function beginPass(f: Frame, a: { tex: GPUTexture; clear: boolean; kind: PassKind }): GPURenderPassEncoder {
  f.stats.passes++;
  return f.enc.beginRenderPass({ colorAttachments: [{ view: a.tex.createView(), loadOp: a.clear ? "clear" : "load", clearValue: [0, 0, 0, 0], storeOp: "store" }], ...timed(f, a.kind) });
}
