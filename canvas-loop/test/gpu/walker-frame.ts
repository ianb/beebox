// Run by brush-pass.gpu.test.ts in a child process, with a new Dawn device:
// render the walker's first frame, and the brush sheet and smear case (every
// brush kind: ink, marker, the stamps, bristle, smudge, wet), at ratio 1 and 2
// and print each frame's SHA-256, one per line.
import { createHash } from "node:crypto";
import type { GpuHandle } from "../../src/device/open.js";
import { openGpu, openTextMeasurer } from "../../src/device/open.js";
import { GpuRenderer } from "../../src/gpu/renderer.js";
import type { Scene } from "../../src/scene/nodes.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";
import { drawSheet } from "./brush-sheet.js";
import { SMEARS_SIZE, drawSmears } from "./smears.js";
import * as walkerSheet from "../../src/gallery/intra-walk-styles/sketch-tea.js";
import { portFrames } from "./cache-cases.js";

/** Every brush kind: the brush sheet (ink, marker, pencil, chalk, airbrush, wash, bristle) and the smear case (smudge, wet). */
export function kindScenes(): Scene[] {
  return [new SceneRecorder({ width: 640, height: 480 }).record((v) => drawSheet(v)).scene, new SceneRecorder(SMEARS_SIZE).record(drawSmears).scene];
}

/** The walker's first frame, then each of `kindScenes`, at ratio 1 and 2, each frame's bytes hashed, on `gpu`. */
export async function walkerHashes(gpu: GpuHandle): Promise<string[]> {
  const [scene] = portFrames(walkerSheet, { at: [0], text: await openTextMeasurer() });
  if (scene === undefined) throw new Error("the walker drew no frame");
  const renderer = new GpuRenderer(gpu);
  try {
    const out: string[] = [];
    for (const s of [scene, ...kindScenes()]) for (const ratio of [1, 2]) out.push(createHash("sha256").update((await renderer.render(s, ratio)).data).digest("hex"));
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
