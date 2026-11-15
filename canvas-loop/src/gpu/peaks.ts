// Testing mode's faint-mark readback (dev-loop row 42). Each brushed mark
// drawn in colour gets a slot; its draws run the peak-writing variant of the
// draw shader (shader-draw.ts), which keeps the largest alpha the mark's
// composite draw resolves (paint alpha × coverage × paper grain × brush
// opacity) with an atomic max. The slots are read back once per rendered
// frame. The opacity of the groups and placements around a mark is applied on
// the CPU: the largest product along any path from the canvas to the mark's
// layer. Mask layers are stencils and material layers are not colour, so
// neither is measured.
import type { ShapeNode } from "../scene/nodes.js";
import type { Item, Job } from "./jobs.js";
import { inter, isEmpty } from "./jobs.js";
import type { PeakPipelines } from "./pipelines.js";

/** One brushed mark's strength in a rendered frame: its peak alpha times its groups' opacity. */
export interface MarkPeak {
  readonly node: ShapeNode;
  readonly alpha: number;
}

/** The frame's marks: each mark item's slot (1 and up), and per slot its node and the opacity around it. */
export interface PeakPlan {
  readonly slots: ReadonlyMap<Item, number>;
  readonly marks: readonly { readonly node: ShapeNode; groups: number }[];
}

/** Plan the slots for `jobs` (children first, as `postOrder` gives them; the canvas last). */
export function planPeaks(jobs: readonly Job[]): PeakPlan {
  // Parents before children: the canvas first, then each layer's opacity times its parent's, the largest over every path.
  const opacity = new Map<Job, number>();
  const root = jobs.at(-1);
  if (root !== undefined) opacity.set(root, 1);
  for (const job of jobs.toReversed()) {
    const outer = opacity.get(job);
    if (outer === undefined) continue;
    for (const it of job.items) if (it.k === "layer") opacity.set(it.job, Math.max(opacity.get(it.job) ?? 0, outer * it.opacity));
  }
  const slots = new Map<Item, number>();
  const byNode = new Map<ShapeNode, number>();
  const marks: { node: ShapeNode; groups: number }[] = [];
  for (const job of jobs) {
    const groups = opacity.get(job);
    if (groups === undefined) continue;
    for (const it of job.items) {
      // Only what encoding draws (encodeJob drops an item outside its job's layer): a mark with no draw would read 0.
      if (it.k !== "mark" || it.node === undefined || it.erase || isEmpty(inter(it.box, job.rect))) continue;
      let slot = byNode.get(it.node);
      if (slot === undefined) {
        marks.push({ node: it.node, groups });
        slot = marks.length;
        byNode.set(it.node, slot);
      }
      const mark = marks[slot - 1];
      if (mark !== undefined) mark.groups = Math.max(mark.groups, groups);
      slots.set(it, slot);
    }
  }
  return { slots, marks };
}

/** What encoding needs for a frame that measures peaks: each mark item's slot, the pipelines and the slots' bind group. */
export interface PeakBinding {
  readonly slots: ReadonlyMap<Item, number>;
  readonly pipes: PeakPipelines;
  readonly group: GPUBindGroup;
}

/** The slots' storage buffer (zeroed) and its bind group; the buffer joins `temp`. */
export function bindPeaks(plan: PeakPlan, a: { device: GPUDevice; pipes: PeakPipelines; temp: GPUBuffer[] }): { binding: PeakBinding; buffer: GPUBuffer } {
  const size = 4 * (plan.marks.length + 1);
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

/** Map the copied slots: each mark's peak alpha times its groups' opacity. */
export async function readPeaks(read: GPUBuffer, plan: PeakPlan): Promise<MarkPeak[]> {
  await read.mapAsync(GPUMapMode.READ);
  const words = new Uint32Array(read.getMappedRange().slice(0));
  read.unmap();
  return plan.marks.map((m, i) => ({ node: m.node, alpha: ((words[i + 1] ?? 0) / 65535) * m.groups }));
}
