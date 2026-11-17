// Testing mode's faint-mark readback (dev-loop row 42). Each brushed mark
// item drawn in colour gets a slot; its draws run the peak-writing variant of
// the draw shader (shader-draw.ts), which keeps the largest alpha the item's
// composite draw resolves (paint alpha × coverage × paper grain × brush
// opacity) with an atomic max. The slots are read back once per rendered
// frame. A mark's strength is the largest over its items. The opacity of the
// groups and placements around it is left out: a sketch sets that number on
// purpose, usually to fade something in or out, and a fade passing through a
// few faint frames is not a mistake. A picture tile drawn this frame keeps its
// marks' strengths beside its kept raster (rasters.ts); a later frame that
// reuses the tile takes them as they are. Mask layers are stencils and
// material layers are not colour, so neither is measured.
import type { ShapeNode } from "../scene/nodes.js";
import type { Item, Job } from "./jobs.js";
import { inter, isEmpty } from "./jobs.js";
import type { PeakPipelines } from "./pipelines.js";

/** One brushed mark's strength in a rendered frame: its peak alpha, before the opacity of its groups and placements. */
export interface MarkPeak {
  readonly node: ShapeNode;
  readonly alpha: number;
}

/** One contribution to a mark's strength: an item measured this frame (its slot), or a kept tile's mark. */
export type PeakPart = { readonly node: ShapeNode } & ({ readonly slot: number } | { readonly alpha: number });

/** The frame's peak slots (one per mark item, 1 and up), what the canvas's marks are made of, and each tile drawn this frame to keep with its marks. */
export interface PeakPlan {
  readonly slots: ReadonlyMap<Item, number>;
  readonly frame: readonly PeakPart[];
  readonly tiles: readonly { readonly job: Job; readonly parts: readonly PeakPart[] }[];
}

/** `start` and every layer below it (kept tiles included). */
function layersFrom(start: Job): Set<Job> {
  const seen = new Set<Job>([start]);
  const work = [start];
  for (let job = work.pop(); job !== undefined; job = work.pop()) {
    for (const it of job.items) {
      if (it.k !== "layer" || seen.has(it.job)) continue;
      seen.add(it.job);
      work.push(it.job);
    }
  }
  return seen;
}

/** The parts of the marks under `start`: items drawn this frame (in `slots`) and kept tiles' marks. */
function partsUnder(start: Job, slots: ReadonlyMap<Item, number>): PeakPart[] {
  const parts: PeakPart[] = [];
  for (const job of layersFrom(start)) {
    for (const it of job.items) {
      const slot = slots.get(it);
      if (slot !== undefined && it.k === "mark" && it.node !== undefined) parts.push({ node: it.node, slot });
    }
    for (const p of job.keptPeaks ?? []) parts.push({ node: p.node, alpha: p.alpha });
  }
  return parts;
}

/** Plan the slots for `jobs` (the jobs encoded this frame, children first, as `postOrder` gives them; the canvas last). */
export function planPeaks(jobs: readonly Job[]): PeakPlan {
  const slots = new Map<Item, number>();
  for (const job of jobs) {
    for (const it of job.items) {
      // Only what encoding draws (encodeJob drops an item outside its job's layer): a mark with no draw would read 0.
      if (it.k === "mark" && it.node !== undefined && !it.erase && !isEmpty(inter(it.box, job.rect))) slots.set(it, slots.size + 1);
    }
  }
  const root = jobs.at(-1);
  return {
    slots,
    frame: root === undefined ? [] : partsUnder(root, slots),
    tiles: jobs.filter((j) => j.keep !== undefined).map((job) => ({ job, parts: partsUnder(job, slots) })),
  };
}

/** Each mark's strength: the largest over its parts of the part's peak (`raw[slot]`, 0..1, or a kept tile's). */
export function peaksOf(parts: readonly PeakPart[], raw: readonly number[]): MarkPeak[] {
  const best = new Map<ShapeNode, number>();
  for (const p of parts) {
    const alpha = "slot" in p ? (raw[p.slot] ?? 0) : p.alpha;
    best.set(p.node, Math.max(best.get(p.node) ?? 0, alpha));
  }
  return [...best].map(([node, alpha]) => ({ node, alpha }));
}

/** What encoding needs for a frame that measures peaks: each mark item's slot, the pipelines and the slots' bind group. */
export interface PeakBinding {
  readonly slots: ReadonlyMap<Item, number>;
  readonly pipes: PeakPipelines;
  readonly group: GPUBindGroup;
}

/** The slots' storage buffer (zeroed) and its bind group; the buffer joins `temp`. */
export function bindPeaks(plan: PeakPlan, a: { device: GPUDevice; pipes: PeakPipelines; temp: GPUBuffer[] }): { binding: PeakBinding; buffer: GPUBuffer } {
  const size = 4 * (plan.slots.size + 1);
  const buffer = a.device.createBuffer({ size: Math.max(16, size), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  a.temp.push(buffer);
  const group = a.device.createBindGroup({ layout: a.pipes.g2, entries: [{ binding: 0, resource: { buffer } }] });
  return { binding: { slots: plan.slots, pipes: a.pipes, group }, buffer };
}

/** After the frame's jobs: copy the slots into a buffer to map (joining `temp`). */
export function copyPeaks(buffer: GPUBuffer, a: { enc: GPUCommandEncoder; device: GPUDevice; temp: GPUBuffer[] }): GPUBuffer {
  const read = a.device.createBuffer({ size: buffer.size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  a.temp.push(read);
  a.enc.copyBufferToBuffer(buffer, 0, read, 0, buffer.size);
  return read;
}

/** Map the copied slots: each slot's peak alpha, 0..1, by slot index (index 0 is unused). */
export async function readPeaks(read: GPUBuffer): Promise<number[]> {
  await read.mapAsync(GPUMapMode.READ);
  const words = new Uint32Array(read.getMappedRange().slice(0));
  read.unmap();
  return Array.from(words, (w) => w / 65535);
}
