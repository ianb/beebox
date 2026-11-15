// Run by brush-pass.gpu.test.ts in a child process, with a new Dawn device:
// render the walker's first frame at ratio 1 and 2 and print each frame's
// SHA-256, one per line.
import { createHash } from "node:crypto";
import type { GpuHandle } from "../../src/device/open.js";
import { openGpu, openTextMeasurer } from "../../src/device/open.js";
import { GpuRenderer } from "../../src/gpu/renderer.js";
import * as walkerSheet from "../../src/gallery/intra-walk-styles/sketch-tea.js";
import { portFrames } from "./cache-cases.js";

/** The walker's first frame at ratio 1 and 2, each frame's bytes hashed, on `gpu`. */
export async function walkerHashes(gpu: GpuHandle): Promise<string[]> {
  const [scene] = portFrames(walkerSheet, { at: [0], text: await openTextMeasurer() });
  if (scene === undefined) throw new Error("the walker drew no frame");
  const renderer = new GpuRenderer(gpu);
  try {
    const out: string[] = [];
    for (const ratio of [1, 2]) out.push(createHash("sha256").update((await renderer.render(scene, ratio)).data).digest("hex"));
    return out;
  } finally {
    renderer.destroy();
  }
}

if (process.argv[2] === "--print") {
  const gpu = await openGpu({});
  if (gpu === undefined) throw new Error("Dawn found no GPU adapter");
  try {
    process.stdout.write(`${(await walkerHashes(gpu)).join("\n")}\n`);
  } finally {
    gpu.destroy();
  }
}
