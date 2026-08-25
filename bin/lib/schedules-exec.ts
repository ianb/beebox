/**
 * Running one child of a scheduled run — the `run` script, the agent session,
 * or the `check` — with the same environment, log, and timeout discipline.
 *
 * One helper rather than one per caller: a hung child is silence, which is the
 * failure the whole plan exists to refuse, so the kill path must be identical
 * everywhere. Kept dependency-free so both the runner and the workstream
 * launcher can use it without an import cycle.
 *
 * Design: callback-box/docs/plans/scheduled-workstreams.md (Track B).
 */

import * as fsSync from "node:fs";
import { spawn } from "node:child_process";

/** Grace between SIGTERM and SIGKILL for a child that overran its timeout. */
const KILL_GRACE_MS = 5000;

/**
 * The environment every child of a run gets: the `run` script, the agent
 * session, and the `check`. One assembly, so a session and the check that
 * judges it can never disagree about which run they belong to.
 */
export function scheduleEnv(input: { name: string; dir: string; runId: string; stateDir: string; dryRun: boolean }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SCHEDULE_NAME: input.name,
    SCHEDULE_DIR: input.dir,
    SCHEDULE_RUN_ID: input.runId,
    SCHEDULE_STATE_DIR: input.stateDir,
  };
  if (input.dryRun) env["SCHEDULE_DRY_RUN"] = "1";
  else delete env["SCHEDULE_DRY_RUN"];
  return env;
}

export interface ExecOutcome {
  /** null when the child was killed for overrunning, or could not be spawned. */
  exitCode: number | null;
  timedOut: boolean;
  output: string;
}

export interface ExecOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  /** Appended to; null captures for stdout (a dry run) and writes nothing. */
  logFile: string | null;
  /** Written to the child's stdin and closed; null gives it no stdin at all. */
  input: string | null;
}

export async function execChild(command: { file: string; args: string[] }, options: ExecOptions): Promise<ExecOutcome> {
  const stream = options.logFile === null ? null : fsSync.createWriteStream(options.logFile, { flags: "a" });
  const chunks: string[] = [];
  const child = spawn(command.file, command.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: [options.input === null ? "ignore" : "pipe", "pipe", "pipe"],
  });

  if (options.input !== null && child.stdin !== null) {
    // A briefing is the prompt; the agent CLIs read it from stdin, so an EPIPE
    // here means the agent exited before reading it — the exit code is the
    // report, not this write.
    child.stdin.on("error", () => { /* ignore: the exit code below is the report */ });
    child.stdin.end(options.input);
  }

  const collect = (data: Buffer): void => {
    const text = data.toString("utf8");
    chunks.push(text);
    stream?.write(text);
  };
  // Both are piped above; the optional call is TypeScript's view of a stdio
  // tuple whose first element is computed, not a state that can happen.
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS).unref();
  }, options.timeoutMs);

  const exitCode = await new Promise<number | null>((resolve) => {
    // A child that cannot be spawned at all (mode bit cleared between lint and
    // run, an agent CLI not on PATH) is a failed run, not a crashed runner.
    child.on("error", (e) => {
      chunks.push(`[schedules] could not execute ${command.file}: ${e.message}\n`);
      stream?.write(`[schedules] could not execute ${command.file}: ${e.message}\n`);
      resolve(null);
    });
    child.on("close", (code) => { resolve(code); });
  });
  clearTimeout(timer);
  await new Promise<void>((resolve) => {
    if (stream === null) { resolve(); return; }
    stream.end(() => { resolve(); });
  });
  return { exitCode: timedOut ? null : exitCode, timedOut, output: chunks.join("") };
}
