/**
 * Wakeup command — runs `bbx wakeup` as a subprocess with streaming output.
 *
 * The CLI wakeup command has complex, CLI-specific logic (agent creation,
 * process.stdout, git commits). Rather than duplicating it, we shell out
 * to `bbx wakeup` and stream its output through the command runner.
 */

import { execSync } from "node:child_process";
import {
  registerCommand,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { buildToolingScriptEnv } from "../script-env.js";
import { runCollectedChild } from "../../lib/run-child.js";
import { parseWakeupOutcome, WAKEUP_OUTCOME_ENV } from "../../cli/commands/wakeup-outcome.js";
import type { WakeupRunResult } from "./wakeup-runner.js";
import { errorMessage } from "../../lib/error-guards.js";

/** Resolve the `bbx` binary path, matching the pattern in scheduler.ts */
function resolveBbxPath(): string {
  try {
    return execSync("which bbx", { encoding: "utf-8" }).trim();
  } catch (e) {
    console.warn("`which bbx` failed, falling back to argv/PATH lookup:", e);
    return process.argv[1] ?? "bbx";
  }
}

/**
 * Run a `bbx wakeup` for a box as a supervised child: awaited, with its
 * combined output captured. Shared with the scan promote worker, which needs
 * the same supervised spawn — a fire-and-forget spawn would make a lost run
 * indefinite rather than late.
 *
 * `connector` scopes the child to one connector (`--connector <name>`), which
 * is what `bbx force-wakeup --connector X` asks for. Leave it unset for the
 * full cycle: the scan promote worker MUST, because a connector-scoped wakeup
 * never drains a `source: scan` job (`cli/commands/wakeup.ts` filters jobs by
 * source), and so must the UI Sync button, which means "run the cycle".
 *
 * Forcing and letting it happen are therefore the same code: this is the same
 * child the schedule runs, with the same flag the schedule would pass.
 */
export async function runBbxWakeup(opts: {
  boxRoot: string;
  triggeredBy: string;
  connector?: string | undefined;
  onChunk?: ((text: string) => void) | undefined;
}): Promise<WakeupRunResult> {
  const bbxPath = resolveBbxPath();
  // Tooling profile: `bbx wakeup` runs the connectors themselves.
  const env = await buildToolingScriptEnv(opts.boxRoot, {
    BBX_TRIGGERED_BY: opts.triggeredBy,
    // Ask for the per-step outcome: the exit code alone cannot say which step
    // failed, and a supervising caller needs to know.
    [WAKEUP_OUTCOME_ENV]: "1",
  });
  try {
    const { code, output } = await runCollectedChild({
      command: bbxPath,
      args: opts.connector === undefined ? ["wakeup"] : ["wakeup", "--connector", opts.connector],
      cwd: opts.boxRoot,
      env,
      ...(opts.onChunk === undefined ? {} : { onChunk: opts.onChunk }),
    });
    const outcome = parseWakeupOutcome(output);
    if (code === 0) return { ok: true, detail: "", output, outcome };
    return { ok: false, detail: `bbx wakeup exited with code ${code}`, output, outcome };
  } catch (err) {
    return { ok: false, detail: errorMessage(err), output: "", outcome: null };
  }
}

async function executeWakeup(
  ctx: CommandContext,
  _args: Record<string, unknown>
): Promise<CommandResult> {
  const result = await runBbxWakeup({
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
