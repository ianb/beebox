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
import { buildToolingScriptEnv } from "../script-env.js";
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

/**
 * Run a FULL (unscoped) `cb wakeup` for a box as a supervised child: awaited,
 * with its combined output captured. Shared with the scan promote worker, which
 * needs the same supervised spawn — a connector-scoped wakeup would never drain
 * a `source: scan` job (`cli/commands/wakeup.ts` filters jobs by source), and a
 * fire-and-forget spawn would make a lost run indefinite rather than late.
 */
export async function runCbWakeup(opts: {
  boxRoot: string;
  triggeredBy: string;
  onChunk?: ((text: string) => void) | undefined;
}): Promise<{ ok: boolean; detail: string; output: string }> {
  const cbPath = resolveCbPath();
  // Tooling profile: `cb wakeup` runs the connectors themselves.
  const env = await buildToolingScriptEnv(opts.boxRoot, { CB_TRIGGERED_BY: opts.triggeredBy });
  try {
    const { code, output } = await runCollectedChild({
      command: cbPath,
      args: ["wakeup"],
      cwd: opts.boxRoot,
      env,
      ...(opts.onChunk === undefined ? {} : { onChunk: opts.onChunk }),
    });
    if (code === 0) return { ok: true, detail: "", output };
    return { ok: false, detail: `cb wakeup exited with code ${code}`, output };
  } catch (err) {
    return { ok: false, detail: errorMessage(err), output: "" };
  }
}

async function executeWakeup(
  ctx: CommandContext,
  _args: Record<string, unknown>
): Promise<CommandResult> {
  const result = await runCbWakeup({
    boxRoot: ctx.boxRoot,
    triggeredBy: "webapp",
    onChunk: (text) => ctx.write(text),
  });
  if (result.ok) return { success: true };
  return { success: false, error: result.detail };
}

registerCommand({
  name: "wakeup",
  description: "Run the full wakeup cycle (preprocess, triage, connectors, jobs, reactor)",
  args: [],
  execute: executeWakeup,
});
