/**
 * Wakeup command — runs `cb wakeup` as a subprocess with streaming output.
 *
 * The CLI wakeup command has complex, CLI-specific logic (agent creation,
 * process.stdout, git commits). Rather than duplicating it, we shell out
 * to `cb wakeup` and stream its output through the command runner.
 */

import { spawn } from "node:child_process";
import { execSync } from "node:child_process";
import {
  registerCommand,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";

/** Resolve the `cb` binary path, matching the pattern in scheduler.ts */
function resolveCbPath(): string {
  try {
    return execSync("which cb", { encoding: "utf-8" }).trim();
  } catch {
    return process.argv[1] ?? "cb";
  }
}

async function executeWakeup(
  ctx: CommandContext,
  _args: Record<string, unknown>
): Promise<CommandResult> {
  const cbPath = resolveCbPath();

  return new Promise((resolve) => {
    const child = spawn(cbPath, ["wakeup"], {
      cwd: ctx.boxRoot,
      env: { ...process.env, CB_TRIGGERED_BY: "webapp" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (data: Buffer) => {
      ctx.write(data.toString());
    });

    child.stderr.on("data", (data: Buffer) => {
      ctx.write(data.toString());
    });

    child.on("error", (err) => {
      resolve({ success: false, error: err.message });
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({ success: false, error: `cb wakeup exited with code ${code}` });
      }
    });
  });
}

registerCommand({
  name: "wakeup",
  description: "Run the full wakeup cycle (preprocess, triage, connectors, jobs, reactor)",
  args: [],
  execute: executeWakeup,
});
