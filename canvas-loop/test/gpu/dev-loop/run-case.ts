// Run one dev-loop case through the headless runner, as an agent would, and
// return what it saw: the thrown error's message (if any) and the transcript.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Msg } from "../../../src/scene/api.js";
import type { GpuHandle } from "../../../src/device/open.js";
import { toTeaModule } from "../../../src/headless/tea-load.js";
import { runSpike } from "../../../src/headless/scene/runner.js";
import { tmpDir } from "../../helpers.js";
import type { DevLoopCase, Model } from "./cases.js";

export interface CaseOutput {
  /** The thrown error, as `Name: message`, or undefined when the run finished. */
  readonly error: string | undefined;
  readonly transcript: string;
  /** The transcript's warning lines. */
  readonly warnings: readonly string[];
}

const tick = (m: Model, msg: Msg): Model => (msg.type === "tick" ? { ...m, t: m.t + 1 } : m);

export async function runCase(c: DevLoopCase, handle: GpuHandle): Promise<CaseOutput> {
  const outDir = tmpDir();
  const module = toTeaModule({
    canvas: c.canvas ?? { width: 80, height: 60 },
    params: c.params ?? {},
    init: (): Model => ({ t: 0, color: "#2a9d8f" }),
    update: c.update ?? tick,
    draw: c.draw,
  });
  let error: string | undefined;
  try {
    await runSpike({ sketchPath: `dev-loop/${c.id}`, module, outDir, frames: c.frames ?? 1, every: 1, seed: 1, ratio: 1, scene: true, events: [] }, handle);
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  const file = join(outDir, "transcript.md");
  const transcript = existsSync(file) ? readFileSync(file, "utf8") : "";
  return { error, transcript, warnings: transcript.split("\n").filter((l) => l.includes("warning:")) };
}
