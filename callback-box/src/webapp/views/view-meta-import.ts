/**
 * Real-import view metadata extraction, isolated in a subprocess.
 *
 * A view module can have top-level side effects (the risk is documented in
 * `docs/implemented-plans/boxes-as-packages-v2.md`'s Failure modes table: "a view module
 * with top-level side effects now executes at list time"). Reading its
 * `name`/`description`/`dependencies`/`modes`/`rendersCardTypes` exports
 * therefore means importing it, which we isolate the same way `cb view
 * check` isolates a full render: a killable child process with a hard
 * timeout, so a pathological view (an infinite loop or a promise that never
 * settles at module scope) can't hang the lister — it just times out and the
 * caller degrades that one view to an error marker.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type { ViewMode } from "../../core/views/types.js";
import { writeNodeViewModule } from "./node-view-runtime.js";
import type { BoxShape } from "../../lib/box-shape.js";

const RUNNER_FILENAME = "extract-meta-runner.mjs";
const IMPORT_TIMEOUT_MS = 3_000;

/** The subprocess entry point: import the module, print its metadata exports as JSON. */
const RUNNER_SOURCE = `const [, , moduleUrl] = process.argv;
try {
  const mod = await import(moduleUrl);
  const out = {};
  if (typeof mod.name === "string") out.name = mod.name;
  if (typeof mod.description === "string") out.description = mod.description;
  if (Array.isArray(mod.dependencies)) out.dependencies = mod.dependencies;
  if (Array.isArray(mod.modes)) out.modes = mod.modes;
  if (Array.isArray(mod.rendersCardTypes)) out.rendersCardTypes = mod.rendersCardTypes;
  process.stdout.write(JSON.stringify(out));
} catch (e) {
  process.stderr.write(String((e && e.stack) || e));
  process.exitCode = 1;
}
`;

export interface ImportedViewMeta {
  name?: string;
  description?: string;
  dependencies?: string[];
  modes?: ViewMode[];
  rendersCardTypes?: string[];
}

/** Run the runner script against `moduleUrl` in a killable child with a timeout. Never rejects. */
function runInSubprocess(dir: string, moduleUrl: string): Promise<ImportedViewMeta | null> {
  return new Promise((resolve) => {
    const runnerPath = path.join(dir, RUNNER_FILENAME);
    const child = spawn(process.execPath, [runnerPath, moduleUrl], {
      timeout: IMPORT_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(stdout) as ImportedViewMeta);
      } catch (_e) {
        resolve(null);
      }
    });
  });
}

/**
 * Compile-then-import a view's node-target output in a subprocess and
 * return its metadata exports, or null if compiling, importing, or parsing
 * failed (including a timeout) — the caller degrades to a filename + error
 * marker in that case, never throws.
 */
export async function importViewMetadata(nodeOutput: string, boxShape: BoxShape): Promise<ImportedViewMeta | null> {
  const mod = await writeNodeViewModule(nodeOutput, boxShape);
  try {
    await fs.writeFile(path.join(mod.dir, RUNNER_FILENAME), RUNNER_SOURCE, "utf-8");
    return await runInSubprocess(mod.dir, mod.moduleUrl);
  } finally {
    await mod.cleanup();
  }
}
