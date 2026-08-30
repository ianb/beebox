/**
 * Subprocess wrappers for `bbx wakeup` (sync) and `bbx finalize`.
 *
 * These spawn the `bbx` CLI as a child process so the reactor can
 * delegate sync and finalize to the same code paths used by manual
 * CLI invocations. They stream stdout/stderr to the reactor's log
 * callback for visibility.
 */

import { buildToolingScriptEnv } from "../script-env.js";
import { runCollectedChild } from "../../lib/run-child.js";
import { errorMessage } from "../../lib/error-guards.js";

/**
 * Run `bbx <command>` as a subprocess, streaming output to `onLog`. Returns
 * whether it exited 0; a failure-to-spawn is logged as `<label> error: …` and
 * reported as `false` (the reactor treats both the same — the step didn't
 * succeed).
 */
async function runBbxSubcommand(
  boxRoot: string,
  { command, label, onLog }: { command: string; label: string; onLog: ((text: string) => void) | undefined }
): Promise<boolean> {
  // Tooling profile: this child IS `bbx wakeup`/`bbx finalize` — it runs the
  // connectors, so it needs the connector credentials an agent must not see.
  const env = await buildToolingScriptEnv(boxRoot);
  try {
    const { code } = await runCollectedChild({
      command: "bbx",
      args: [command],
      cwd: boxRoot,
      env,
      ...(onLog !== undefined ? { onChunk: onLog } : {}),
    });
    return code === 0;
  } catch (err) {
    onLog?.(`${label} error: ${errorMessage(err)}\n`);
    return false;
  }
}

/**
 * Run `bbx wakeup` as a subprocess to sync external sources.
 */
export async function runSync(boxRoot: string, onLog?: (text: string) => void): Promise<boolean> {
  return runBbxSubcommand(boxRoot, { command: "wakeup", label: "Sync", onLog });
}

/**
 * Run `bbx finalize` as a subprocess to flush outbound cards.
 */
export async function runFinalize(boxRoot: string, onLog?: (text: string) => void): Promise<boolean> {
  return runBbxSubcommand(boxRoot, { command: "finalize", label: "Finalize", onLog });
}
