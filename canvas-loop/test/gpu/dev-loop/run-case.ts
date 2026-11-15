// Run one dev-loop case through the headless runner, as an agent would, and
// return what it saw: the run's error line (if any) and the transcript.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Msg } from "../../../src/scene/api.js";
import { toTeaModule } from "../../../src/headless/tea-load.js";
import { teaRun } from "../../../src/headless/tea-runtime/runner.js";
import { tmpDir } from "../../helpers.js";
import type { DevLoopCase, Model } from "./cases.js";

export interface CaseOutput {
  /** The run's error line (`frame N: error in <step>: Name: message`), or undefined when the run finished. */
  readonly error: string | undefined;
  readonly transcript: string;
  /** The transcript's warning lines. */
  readonly warnings: readonly string[];
}

const tick = (m: Model, msg: Msg): Model => (msg.type === "tick" ? { ...m, t: m.t + 1 } : m);

export async function runCase(c: DevLoopCase): Promise<CaseOutput> {
  const outDir = tmpDir();
  const module = toTeaModule({
    canvas: c.canvas ?? { width: 80, height: 60 },
    params: c.params ?? {},
    init: (): Model => ({ t: 0, color: "#2a9d8f" }),
    update: c.update ?? tick,
    draw: c.draw,
    renderer: "scene",
  });
  const result = await teaRun({ sketchPath: `dev-loop/${c.id}`, module, outDir, frames: c.frames ?? 1, every: 1, seed: 1, fps: 60, ratio: 1, scene: true, events: [], eventsPath: undefined });
  const file = join(outDir, "transcript.md");
  const transcript = existsSync(file) ? readFileSync(file, "utf8") : "";
  return { error: result.errors[0], transcript, warnings: transcript.split("\n").filter((l) => l.includes("** warn: ")) };
}
