/**
 * Real-import view metadata extraction, isolated in a subprocess.
 *
 * A view module can have top-level side effects (the risk is documented in
 * `docs/implemented-plans/boxes-as-packages-v2.md`'s Failure modes table: "a view module
 * with top-level side effects now executes at list time"). Reading its
 * `name`/`description`/`dependencies`/`modes`/`layout`/`rendersCardTypes`
 * exports
 * therefore means importing it, which we isolate the same way `bbx view
 * check` isolates a full render: a killable child process with a hard
 * timeout, so a pathological view (an infinite loop or a promise that never
 * settles at module scope) can't hang the lister — it just times out and the
 * caller degrades that one view to an error marker.
 *
 * The parent's timeout dies with the parent, so the child also bounds itself:
 * a worker thread SIGKILLs the runner at a deadline. A worker keeps its own
 * event loop, so it fires while the import spins the main thread. A CPU-time
 * limit was tried first; a `SIGXCPU` handler (tap installs one) swallows it,
 * and macOS sends no SIGKILL at the hard limit. On 2026-10-16 an orphaned
 * runner had spun for 16 days.
 *
 * The view is box-authored code and its exports come back as metadata the
 * server lists, so the child must not see the server's environment: a view
 * exporting `name = process.env.BBX_HUB_SECRET` would publish the secret. It
 * gets `agentAllowlistEnv()`, the agent profile's inherited allowlist without
 * the values `buildScriptEnv` injects: importing a module needs no way back to
 * the server, and an engine-hosted compile has no box to derive one from.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import { writeNodeViewModule, type ViewHostContext } from "../node-view-runtime.js";
import { agentAllowlistEnv } from "../../../core/script-env/core.js";

const RUNNER_FILENAME = "extract-meta-runner.mjs";
const IMPORT_TIMEOUT_MS = 3_000;
/** The runner's own deadline; past the parent's timeout, so it binds only once the parent is gone. */
const RUNNER_DEADLINE_MS = IMPORT_TIMEOUT_MS * 2;

/** The subprocess entry point: import the module, print its metadata exports as JSON. */
const RUNNER_SOURCE = `import { Worker } from "node:worker_threads";
const [, , moduleUrl] = process.argv;
new Worker("setTimeout(() => process.kill(process.pid, 'SIGKILL'), ${String(RUNNER_DEADLINE_MS)});", { eval: true }).unref();
try {
  const mod = await import(moduleUrl);
  const out = {};
  if (typeof mod.name === "string") out.name = mod.name;
  if (typeof mod.description === "string") out.description = mod.description;
  if (Array.isArray(mod.dependencies)) out.dependencies = mod.dependencies;
  if (Array.isArray(mod.modes)) out.modes = mod.modes;
  // Passed through whatever its type, so the schema rejects a bad value
  // instead of the runner silently dropping it.
  if (mod.layout !== undefined) out.layout = mod.layout;
  if (Array.isArray(mod.rendersCardTypes)) out.rendersCardTypes = mod.rendersCardTypes;
  process.stdout.write(JSON.stringify(out));
} catch (e) {
  process.stderr.write(String((e && e.stack) || e));
  process.exitCode = 1;
}
`;

/** Metadata a view module may export, validated at the subprocess boundary. */
const importedViewMetaSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
  modes: z.array(z.enum(["page", "chat"])).optional(),
  layout: z.enum(["inset", "full-bleed"]).optional(),
  rendersCardTypes: z.array(z.string()).optional(),
});
export type ImportedViewMeta = z.infer<typeof importedViewMetaSchema>;

/**
 * The import outcome: the metadata, a description of the export that failed
 * validation, or null when compiling or importing failed.
 */
export type ImportedViewMetaResult = { meta: ImportedViewMeta } | { invalid: string } | null;

/** Run the runner script against `moduleUrl` in a killable child with a timeout. Never rejects. */
function runInSubprocess(dir: string, moduleUrl: string): Promise<ImportedViewMetaResult> {
  return new Promise((resolve) => {
    const runnerPath = path.join(dir, RUNNER_FILENAME);
    const child = spawn(process.execPath, [runnerPath, moduleUrl], {
      env: agentAllowlistEnv(),
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
        const parsed = importedViewMetaSchema.safeParse(JSON.parse(stdout));
        if (parsed.success) {
          resolve({ meta: parsed.data });
          return;
        }
        const issue = parsed.error.issues[0];
        resolve({ invalid: issue ? `${issue.path.join(".")}: ${issue.message}` : parsed.error.message });
      } catch (_e) {
        resolve(null);
      }
    });
  });
}

/**
 * Compile-then-import a view's node-target output in a subprocess and
 * return its metadata exports, which export failed validation, or null if
 * compiling or importing failed (including a timeout) — the caller degrades
 * to a filename + error marker, never throws.
 */
export async function importViewMetadata(nodeOutput: string, host: ViewHostContext): Promise<ImportedViewMetaResult> {
  const mod = await writeNodeViewModule(nodeOutput, host);
  try {
    await fs.writeFile(path.join(mod.dir, RUNNER_FILENAME), RUNNER_SOURCE, "utf-8");
    return await runInSubprocess(mod.dir, mod.moduleUrl);
  } finally {
    await mod.cleanup();
  }
}
