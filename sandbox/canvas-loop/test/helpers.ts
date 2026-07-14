import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunOptions } from "../src/runtime.js";
import type { SketchModule } from "../src/types.js";

/** Fresh temp directory for a test run's out/ output. */
export function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "canvas-loop-"));
}

/** Build RunOptions with sensible defaults, overridable per test. */
export function runOptions(module: SketchModule, overrides: Partial<RunOptions> & { outDir: string }): RunOptions {
  return {
    module,
    sketchPath: "test.ts",
    frames: 10,
    seed: 42,
    fps: 60,
    every: 30,
    events: [],
    eventsPath: undefined,
    ...overrides,
  };
}

/** Read every file in a directory into a name→bytes map (sorted by name). */
export function readDirBytes(dir: string): Map<string, Buffer> {
  const files = readdirSync(dir).toSorted();
  const out = new Map<string, Buffer>();
  for (const name of files) out.set(name, readFileSync(join(dir, name)));
  return out;
}

/** Read a transcript.md from an out/ directory. */
export function readTranscript(dir: string): string {
  return readFileSync(join(dir, "transcript.md"), "utf8");
}
