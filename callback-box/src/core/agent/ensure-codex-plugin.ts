/**
 * Install the callback-box Codex plugin from the package's local marketplace.
 *
 * The registration this writes is GLOBAL machine state — one `callback-box`
 * marketplace entry in `~/.codex/config.toml`, shared by every checkout on the
 * machine. Two rules follow from that, and both are load-bearing:
 *
 * - **Don't fight over it.** A worktree, a temp checkout, and the main
 *   checkout all run this code. If each re-pointed the entry at itself, the
 *   last one to run would own it — and a checkout that is later deleted leaves
 *   a registration whose root is gone. So an existing registration at the
 *   expected plugin version is left alone as long as its path still exists;
 *   only a missing path or a version mismatch earns a re-point.
 * - **Repair rather than throw.** `codex plugin list` is exactly the command a
 *   dangling registration breaks ("marketplace root does not contain a
 *   supported manifest"), so an installer that treats its failure as fatal can
 *   never fix the state it created. A failed list means remove-and-re-add.
 *
 * Tests never reach the real `~/.codex` — `.taprc` points `CODEX_HOME` at a
 * per-checkout throwaway (`test/helpers/isolate-codex-home.ts`).
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { z } from "zod";
import { PACKAGE_ROOT } from "../../lib/package-root.js";

const execFileAsync = promisify(execFile);
const pluginListSchema = z.object({
  installed: z.array(z.looseObject({
    pluginId: z.string(),
    version: z.string(),
    source: z.looseObject({ path: z.string() }),
  })),
});
const MARKETPLACE = "callback-box";
const PLUGIN_ID = "callback-box-codex@callback-box";
const PLUGIN_VERSION = "0.1.1";

export class CodexPluginInstallError extends Error {
  constructor(cause: unknown) {
    super("Could not install the Callback Box Codex plugin", { cause });
    this.name = "CodexPluginInstallError";
  }
}

/** One `codex` invocation, resolving to its stdout. Injected so tests can watch. */
export type CodexCommand = (args: string[]) => Promise<string>;

const runCodex: CodexCommand = async (args) => (await execFileAsync("codex", args)).stdout;

/**
 * The installed plugin's version and root, or `null` when Codex can't answer.
 *
 * `null` is the repair signal, not an error: the common cause is the dangling
 * registration this module exists to heal, and the CLI reports that by failing
 * the list rather than by returning an empty one.
 */
async function readInstalled(run: CodexCommand): Promise<{ version: string; path: string } | null> {
  let stdout: string;
  try {
    stdout = await run(["plugin", "list", "--json"]);
  } catch (error) {
    console.warn("[codex-plugin] `codex plugin list` failed; re-registering the marketplace:", error);
    return null;
  }
  const found = pluginListSchema.parse(JSON.parse(stdout)).installed
    .find((plugin) => plugin.pluginId === PLUGIN_ID);
  return found === undefined ? null : { version: found.version, path: found.source.path };
}

/**
 * Point the `callback-box` marketplace at this checkout and install from it.
 *
 * The removals are best-effort by design: this runs precisely when the current
 * state is unknown or broken, so "there was nothing to remove" and "the entry
 * was too broken to remove cleanly" are both fine — the `add` that follows is
 * what has to succeed.
 */
async function reregister(run: CodexCommand): Promise<void> {
  const cleanup = [
    ["plugin", "remove", PLUGIN_ID, "--json"],
    ["plugin", "marketplace", "remove", MARKETPLACE, "--json"],
  ];
  for (const args of cleanup) {
    await run(args).catch((error: unknown) => {
      console.debug("[codex-plugin] cleanup before re-registering failed (expected when nothing is registered):", error);
      return "";
    });
  }
  await run(["plugin", "marketplace", "add", PACKAGE_ROOT, "--json"]);
  await run(["plugin", "add", PLUGIN_ID, "--json"]);
}

/** The whole decision, with the `codex` runner injected. Exported for tests. */
export async function installCodexPlugin(run: CodexCommand): Promise<void> {
  try {
    const installed = await readInstalled(run);
    // Another checkout's registration is fine as long as it is still there and
    // current: the entry is shared, and churning it is what breaks the others.
    if (installed !== null && installed.version === PLUGIN_VERSION && existsSync(installed.path)) return;
    await reregister(run);
  } catch (error) {
    throw new CodexPluginInstallError(error);
  }
}

let installation: Promise<void> | null = null;

/** Idempotent per process; performs no global mutation unless Codex is selected. */
export function ensureCodexPluginInstalled(): Promise<void> {
  installation ??= installCodexPlugin(runCodex);
  return installation;
}
