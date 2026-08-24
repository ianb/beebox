/**
 * Run a shell command with a reliable, sleep-immune timeout.
 *
 * Spawns through a process group so the entire tree can be killed on
 * expiry (a plain kill leaves grandchildren running). The deadline counts
 * only awake time — see lib/awake-timeout.ts for why a single setTimeout
 * would instead fire the moment the machine wakes from a sleep that
 * started mid-run, killing work that barely got to execute.
 *
 * Captures tails of stdout and stderr to include in error messages:
 * stdout is where most scheduled commands (including `cb prompt`) surface
 * their actual diagnostic output.
 */

import { spawn } from "node:child_process";
import { startAwakeTimeout, type AwakeElapsed } from "./awake-timeout.js";

/** Default per-script timeout: 10 minutes of awake runtime. */
export const SCRIPT_TIMEOUT = 10 * 60 * 1000;

export interface ExecTiming {
  /** Awake runtime of the command (sleep excluded). */
  durationMs: number;
  /** True when the machine slept while the command ran. */
  sleepAffected: boolean;
}

/** Base class for command outcomes that carry their measured timing. */
export class CommandError extends Error {
  readonly timing: ExecTiming;
  constructor(message: string, timing: ExecTiming) {
    super(message);
    this.name = "CommandError";
    this.timing = timing;
  }
}

export class CommandTimedOutError extends CommandError {
  constructor(message: string, timing: ExecTiming) {
    super(message, timing);
    this.name = "CommandTimedOutError";
  }
}

export class CommandFailedError extends CommandError {
  /** The child's exit code, or null when it died on a signal. Callers that
   *  distinguish exit statuses (an inconclusive run exits 2, not 1) read it
   *  from here rather than re-parsing the message. */
  readonly exitCode: number | null;
  constructor(message: string, params: { timing: ExecTiming; exitCode: number | null }) {
    super(message, params.timing);
    this.name = "CommandFailedError";
    this.exitCode = params.exitCode;
  }
}

export interface ExecWithTimeoutOptions {
  cwd: string;
  /** "inherit" mirrors child output to the parent; "ignore" captures only. */
  stdio: "inherit" | "ignore";
  /** Awake-time budget in ms. */
  timeout: number;
  env: NodeJS.ProcessEnv;
  /** Awake-timer tick period override; tests pass something small. */
  periodMs?: number;
}

function toTiming(elapsed: AwakeElapsed): ExecTiming {
  return {
    durationMs: Math.round(elapsed.awakeMs),
    sleepAffected: elapsed.sleepDetected,
  };
}

export function execWithTimeout(
  command: string,
  options: ExecWithTimeoutOptions,
): Promise<ExecTiming> {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", command], {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: options.env,
      detached: true,
    });

    const MAX_STDERR = 2000;
    const MAX_STDOUT = 4000;
    let stderrBuf = "";
    let stdoutBuf = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      if (stdoutBuf.length > MAX_STDOUT * 2) {
        stdoutBuf = stdoutBuf.slice(-MAX_STDOUT);
      }
      if (options.stdio === "inherit") {
        process.stdout.write(chunk);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      if (stderrBuf.length > MAX_STDERR * 2) {
        stderrBuf = stderrBuf.slice(-MAX_STDERR);
      }
      if (options.stdio === "inherit") {
        process.stderr.write(chunk);
      }
    });

    const timer = startAwakeTimeout({
      timeoutMs: options.timeout,
      ...(options.periodMs !== undefined && { periodMs: options.periodMs }),
      onTimeout: (elapsed) => {
        // child.pid is undefined only when spawn() never got a process off the
        // ground (e.g. the shell itself failed to launch) — nothing to kill.
        if (child.pid !== undefined) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch (_e) {
            // process group already exited — nothing to kill
          }
        }
        const slept = elapsed.sleepDetected
          ? ` (${String(Math.round(elapsed.wallMs / 1000))}s wall clock — the machine slept mid-run)`
          : "";
        const base = `Command timed out after ${String(options.timeout)}ms of awake runtime${slept}`;
        reject(new CommandTimedOutError(
          appendOutputTail(base, { stdout: stdoutBuf, stderr: stderrBuf }),
          toTiming(elapsed),
        ));
      },
    });

    child.on("close", (code) => {
      timer.stop();
      const timing = toTiming(timer.elapsed());
      if (code === 0) {
        resolve(timing);
      } else {
        const base = `Command failed with exit code ${String(code)}`;
        reject(new CommandFailedError(
          appendOutputTail(base, { stdout: stdoutBuf, stderr: stderrBuf }),
          { timing, exitCode: code },
        ));
      }
    });

    child.on("error", (err) => {
      timer.stop();
      reject(err);
    });
  });
}

/**
 * Append a tail of stdout/stderr to an error headline, after stripping
 * universally-noisy lines (Node deprecation warnings). Keeps enough context
 * to diagnose the failure without flooding the scheduler log.
 */
function appendOutputTail(
  headline: string,
  bufs: { stdout: string; stderr: string },
): string {
  const stderrTail = tailChars(stripNodeNoise(bufs.stderr), 500);
  const stdoutTail = tailChars(stripNodeNoise(bufs.stdout), 2000);
  const parts = [headline];
  if (stderrTail) parts.push(`stderr:\n${stderrTail}`);
  if (stdoutTail) parts.push(`stdout:\n${stdoutTail}`);
  return parts.join("\n");
}

function stripNodeNoise(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\(node:\d+\) \[DEP\d+] DeprecationWarning:/.test(line))
    .filter((line) => !/^\(Use `node --trace-deprecation/.test(line))
    .join("\n");
}

function tailChars(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return "…" + trimmed.slice(-max);
}
