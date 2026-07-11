/**
 * Wakeup command — runs `cb wakeup` as a subprocess with streaming output.
 *
 * The CLI wakeup command has complex, CLI-specific logic (agent creation,
 * process.stdout, git commits). Rather than duplicating it, we shell out
 * to `cb wakeup` and stream its output through the command runner.
 */

import { execSync } from "node:child_process";
import {
  registerCommand,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { buildScriptEnv } from "../script-env.js";
import { runCollectedChild } from "../../lib/run-child.js";
import { errorMessage } from "../../lib/error-guards.js";

/** Resolve the `cb` binary path, matching the pattern in scheduler.ts */
function resolveCbPath(): string {
  try {
    return execSync("which cb", { encoding: "utf-8" }).trim();
  } catch (e) {
    console.warn("`which cb` failed, falling back to argv/PATH lookup:", e);
    return process.argv[1] ?? "cb";
  }
}

async function executeWakeup(
  ctx: CommandContext,
  _args: Record<string, unknown>
): Promise<CommandResult> {
  const cbPath = resolveCbPath();
  const env = await buildScriptEnv(ctx.boxRoot, { CB_TRIGGERED_BY: "webapp" });

  try {
    const { code } = await runCollectedChild({
      command: cbPath,
      args: ["wakeup"],
      cwd: ctx.boxRoot,
      env,
      onChunk: (text) => ctx.write(text),
    });
    if (code === 0) return { success: true };
    return { success: false, error: `cb wakeup exited with code ${code}` };
  } catch (err) {
    return { success: false, error: errorMessage(err) };
  }
}

registerCommand({
  name: "wakeup",
  description: "Run the full wakeup cycle (preprocess, triage, connectors, jobs, reactor)",
  args: [],
  execute: executeWakeup,
});
