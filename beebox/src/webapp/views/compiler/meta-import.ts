/**
 * Real-import view metadata extraction, isolated in a subprocess.
 *
 * A view module can have top-level side effects (the risk is documented in
 * `docs/implemented-plans/boxes-as-packages-v2.md`'s Failure modes table: "a view module
 * with top-level side effects now executes at list time"). Reading its
 * `name`/`description`/`dependencies`/`modes`/`layout`/`rendersCardTypes`/
 * `checkStates` exports
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
  // JSON drops a function; send its type instead, so the schema rejects it.
  if (mod.checkStates !== undefined) out.checkStates = typeof mod.checkStates === "function" ? "function" : mod.checkStates;
  process.stdout.write(JSON.stringify(out));
} catch (e) {
  process.stderr.write(String((e && e.stack) || e));
  process.exitCode = 1;
}
`;

/**
 * One `checkStates` entry. The card goes in `path` only: the view receives it
 * as `params.path`, so a `params.path` as well would be two places for it.
 * `view`, `viewState` and `fragment` are view-URL keys the app keeps for
 * itself (frontend `lib/view-url.ts`); the view never sees them as params.
 */
const RESERVED_PARAMS = ["path", "view", "viewState", "fragment"];
const declaredCheckStateSchema = z.object({
  name: z.string().regex(/^[\da-z][\da-z-]*$/, "use lowercase letters, digits and hyphens"),
  path: z.string().min(1),
  params: z.record(z.string(), z.string()).superRefine((params, ctx) => {
    for (const key of RESERVED_PARAMS.filter((k) => k in params)) {
      ctx.addIssue({ code: "custom", path: [key], message: key === "path" ? "give the card as the state's path, not params.path" : `"${key}" is a view-URL key the view never receives` });
    }
  }).optional(),
}).strict();

/** Metadata a view module may export, validated at the subprocess boundary. */
const importedViewMetaSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
  modes: z.array(z.enum(["page", "chat", "strip"])).optional(),
  layout: z.enum(["inset", "full-bleed"]).optional(),
  rendersCardTypes: z.array(z.string()).optional(),
  checkStates: z.array(declaredCheckStateSchema).superRefine((states, ctx) => {
    const seen = new Set<string>();
    for (const [index, state] of states.entries()) {
      if (seen.has(state.name)) ctx.addIssue({ code: "custom", path: [index, "name"], message: `duplicate state name "${state.name}"` });
      seen.add(state.name);
    }
  }).optional(),
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
