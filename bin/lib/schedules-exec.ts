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

/** How many trailing lines of a child's output stay in memory for the tails an
 *  alert carries. The LOG on disk keeps everything up to the cap below. */
export const OUTPUT_TAIL_LINES = 400;
/** Byte ceiling on that in-memory tail, for output with no newlines in it. */
export const OUTPUT_TAIL_BYTES = 256 * 1024;
/** Per-run log ceiling. Past it the log is truncated with a marker and the run
 *  is recorded as failed: a runner that OOMs writes no accounting at all. */
export const LOG_MAX_BYTES = 50 * 1024 * 1024;
const TRUNCATION_MARKER = "\n[schedules] output exceeded the per-run log cap; the rest was discarded.\n";

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
  /** The TAIL of what the child wrote — the last `OUTPUT_TAIL_LINES` lines,
   *  never the whole stream. The log file is where everything is. */
  output: string;
  /** The child wrote past the per-run log cap; the log is incomplete. */
  logTruncated: boolean;
}

/**
 * A bounded tail of a stream. Everything a child emits used to be concatenated
 * in memory as well as written to disk, so one runaway `run` script could take
 * the runner down before it recorded anything — including the alert that would
 * have said so.
 */
class OutputTail {
  private lines: string[] = [];
  private partial = "";

  push(text: string): void {
    const parts = `${this.partial}${text}`.split("\n");
    this.partial = parts.pop() ?? "";
    this.lines.push(...parts);
    if (this.lines.length > OUTPUT_TAIL_LINES) this.lines = this.lines.slice(-OUTPUT_TAIL_LINES);
  }

  text(): string {
    if (this.lines.length === 0 && this.partial === "") return "";
    // A trailing empty element restores the final newline the split consumed.
    const all = [...this.lines, this.partial];
    const joined = all.join("\n");
    return joined.length <= OUTPUT_TAIL_BYTES ? joined : joined.slice(-OUTPUT_TAIL_BYTES);
  }
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
  const tail = new OutputTail();
  let logBytes = 0;
  let logTruncated = false;
  const child = spawn(command.file, command.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: [options.input === null ? "ignore" : "pipe", "pipe", "pipe"],
    // Its own process GROUP, so the timeout can kill everything the run
    // started. A `run` script is routinely a shell that spawns pnpm which
    // spawns node; killing the shell alone left those running past the
    // timeout, still writing the checkout the next run was about to use.
    detached: true,
  });

  if (options.input !== null && child.stdin !== null) {
    // A briefing is the prompt; the agent CLIs read it from stdin, so an EPIPE
    // here means the agent exited before reading it — the exit code is the
    // report, not this write.
    child.stdin.on("error", () => { /* ignore: the exit code below is the report */ });
    child.stdin.end(options.input);
  }

  const write = (text: string): void => {
    if (stream === null || logTruncated) return;
    if (logBytes + Buffer.byteLength(text, "utf8") > LOG_MAX_BYTES) {
      logTruncated = true;
      stream.write(TRUNCATION_MARKER);
      return;
    }
    logBytes += Buffer.byteLength(text, "utf8");
    stream.write(text);
  };
  const collect = (data: Buffer): void => {
    const text = data.toString("utf8");
    tail.push(text);
    write(text);
  };
  // Both are piped above; the optional call is TypeScript's view of a stdio
  // tuple whose first element is computed, not a state that can happen.
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killGroup(child.pid, "SIGTERM");
    setTimeout(() => { killGroup(child.pid, "SIGKILL"); }, KILL_GRACE_MS).unref();
  }, options.timeoutMs);

  const exitCode = await new Promise<number | null>((resolve) => {
    // A child that cannot be spawned at all (mode bit cleared between lint and
    // run, an agent CLI not on PATH) is a failed run, not a crashed runner.
    child.on("error", (e) => {
      const message = `[schedules] could not execute ${command.file}: ${e.message}\n`;
      tail.push(message);
      write(message);
      resolve(null);
    });
    child.on("close", (code) => { resolve(code); });
  });
  clearTimeout(timer);
  await new Promise<void>((resolve) => {
    if (stream === null) { resolve(); return; }
    stream.end(() => { resolve(); });
  });
  return { exitCode: timedOut ? null : exitCode, timedOut, output: tail.text(), logTruncated };
}

/**
 * Signal the child's whole process GROUP (`kill(-pgid)`), which is the child's
 * own pid because it was spawned detached. A group that is already gone, or a
 * child that never spawned, is not an error — the kill is best effort by
 * definition, and the exit code below is the report.
 */
function killGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone.
    }
  }
}
