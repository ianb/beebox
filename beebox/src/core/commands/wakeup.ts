/**
 * Wakeup command — runs `bbx wakeup` as a subprocess with streaming output.
 *
 * The CLI wakeup command has complex, CLI-specific logic (agent creation,
 * process.stdout, git commits). Rather than duplicating it, we shell out
 * to `bbx wakeup` and stream its output through the command runner.
 */

import { execSync } from "node:child_process";
import {
  type CommandContext,
  type CommandDefinition,
  type CommandResult,
} from "../command-types.js";
import { buildToolingScriptEnv } from "../script-env/core.js";
import { runCollectedChild } from "../../lib/run-child.js";
import { parseWakeupOutcome, WAKEUP_CYCLE_ACQUIRED, WAKEUP_OUTCOME_ENV } from "../../cli/wakeup-outcome.js";
import type { WakeupRunner, WakeupRunResult } from "../wakeup-runner.js";
import { errorMessage } from "../../shared/error-guards.js";

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
 * How many `runBbxWakeup` children this process is waiting on. The box
 * server's idle exit reads it: a server must not drain while a wakeup it
 * spawned (job check, scan, filing, force) runs.
 */
let liveCount = 0;

export function liveWakeups(): number {
  return liveCount;
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
 * never drains a scan intake job, which has no `connector`
 * (`cli/commands/wakeup/command.ts` filters jobs by connector), and so must
 * the scheduler pass's job check, which starts one for unscoped jobs.
 *
 * Forcing and letting it happen are therefore the same code: this is the same
 * child the schedule runs, with the same flag the schedule would pass.
 */
export async function runBbxWakeup(opts: {
  boxRoot: string;
  triggeredBy: string;
  connector?: string | undefined;
  /** `--max-cycles`: reactor cycles while jobs remain; the child's default is 1. */
  maxCycles?: number | undefined;
  onChunk?: ((text: string) => void) | undefined;
}): Promise<WakeupRunResult> {
  liveCount += 1;
  try {
    return await superviseWakeup(opts);
  } finally {
    liveCount -= 1;
  }
}

function wakeupArgs(opts: { connector?: string | undefined; maxCycles?: number | undefined }): string[] {
  return [
    "engine",
    "wakeup",
    ...(opts.connector === undefined ? [] : ["--connector", opts.connector]),
    ...(opts.maxCycles === undefined ? [] : ["--max-cycles", String(opts.maxCycles)]),
  ];
}

async function superviseWakeup(opts: Parameters<typeof runBbxWakeup>[0]): Promise<WakeupRunResult> {
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
      args: wakeupArgs(opts),
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

/** What a started wakeup answered before its run ended. */
export interface WakeupStart {
  /**
   * `started`: the child took the cycle lock. `running`: another cycle held
   * it, so this child did nothing. `failed`: the child ended any other way
   * before taking it.
   */
  state: "started" | "running" | "failed";
  detail: string;
  /** The whole run. */
  done: Promise<WakeupRunResult>;
}

/**
 * Start a supervised wakeup and answer once the child has taken the cycle
 * lock (`[wakeup-cycle] acquired`), without waiting for the run. Checking
 * the lock and then spawning would leave a gap in which a scoped, scan, or
 * filing wakeup takes it; this answers what the child actually did.
 * `run` is `runBbxWakeup` unless a test injects a child stream.
 */
export function startBbxWakeup(opts: {
  boxRoot: string;
  triggeredBy: string;
  maxCycles?: number | undefined;
  run?: WakeupRunner | undefined;
}): Promise<WakeupStart> {
  const run = opts.run ?? runBbxWakeup;
  let markAcquired: () => void = () => {};
  const acquired = new Promise<void>((resolve) => {
    markAcquired = resolve;
  });
  let seen = "";
  let sawAcquired = false;
  const done = run({
    boxRoot: opts.boxRoot,
    triggeredBy: opts.triggeredBy,
    maxCycles: opts.maxCycles,
    onChunk: (text) => {
      if (sawAcquired) return;
      // A chunk boundary may split the line: keep enough of the tail to see it.
      seen = (seen + text).slice(-(text.length + WAKEUP_CYCLE_ACQUIRED.length));
      if (!seen.includes(WAKEUP_CYCLE_ACQUIRED)) return;
      sawAcquired = true;
      markAcquired();
    },
  });
  const ended = done.then(
    (result): WakeupStart => {
      if (sawAcquired) return { state: "started", detail: "", done };
      if (result.outcome?.skipped === "wakeup-running") {
        return { state: "running", detail: "Another wakeup cycle held the lock, so this one did nothing.", done };
      }
      return { state: "failed", detail: result.ok ? "The wakeup ended without taking the cycle lock." : result.detail, done };
    },
    (error: unknown): WakeupStart => ({ state: "failed", detail: errorMessage(error), done }),
  );
  return Promise.race([acquired.then((): WakeupStart => ({ state: "started", detail: "", done })), ended]);
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

export const wakeupCommand: CommandDefinition = {
  name: "wakeup",
  description: "Run the full wakeup cycle (preprocess, triage, connectors, jobs, reactor)",
  args: [],
  execute: executeWakeup,
};
