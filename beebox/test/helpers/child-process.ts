/**
 * Real second processes for tests.
 *
 * `spawnUntilFirstLine` resolves once the child prints its first stdout line,
 * decoded as a string, so a test waits on "the child holds the lock" without
 * comparing bytes to text. The child's stderr is captured, never inherited: a
 * passing test stays quiet, and an early exit reports what the child said.
 *
 * The wait is bounded: a child that prints no line within `readyMs` (default
 * 30 s) is killed, and the wait fails with its stderr.
 *
 * `spawnThenAbandon` starts a child and closes every pipe to it at once, the
 * way they close when the parent dies. An orphan test that kept a reader open
 * would hide a write that fails with EPIPE in the real case.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";

const PACKAGE_ROOT = join(import.meta.dirname, "../..");

export interface ChildSpec {
  command: string;
  args: string[];
  /** Defaults to this process's environment. */
  env?: NodeJS.ProcessEnv;
  /** How long `spawnUntilFirstLine` waits for the first line. */
  readyMs?: number;
}

/** A TypeScript script run under tsx. Children run from the package root. */
export function tsxChild(script: string, args: string[]): ChildSpec {
  return { command: process.execPath, args: ["--import", "tsx", script, ...args] };
}

/** How a child ended. `spawnError` is set when it never started (no such executable). */
export interface ChildExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  spawnError?: string;
}

export interface StartedChild {
  child: ChildProcessWithoutNullStreams;
  /** Settles when the child has exited and its pipes have closed. */
  exited: Promise<ChildExit>;
  /** SIGKILL the child, if it is still running, and wait for it to exit. */
  kill(): Promise<ChildExit>;
}

export interface ReadyChild extends StartedChild {
  /** The first stdout line, without its newline. */
  line: string;
  /** All stderr text so far. */
  stderr(): string;
}

function start(spec: ChildSpec): StartedChild {
  const child = spawn(spec.command, spec.args, {
    cwd: PACKAGE_ROOT,
    env: spec.env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exited = new Promise<ChildExit>((resolve) => {
    // `close`, not `exit`: it comes after the child's output has all been read.
    child.once("close", (code, signal) => { resolve({ code, signal }); });
    child.once("error", (error) => { if (child.pid === undefined) resolve({ code: null, signal: null, spawnError: error.message }); });
  });
  return {
    child,
    exited,
    kill: async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      return exited;
    },
  };
}

/** Start the child; resolve on its first stdout line. */
export async function spawnUntilFirstLine(spec: ChildSpec): Promise<ReadyChild> {
  const started = start(spec);
  const { child } = started;
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const readyMs = spec.readyMs ?? 30_000;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void started.kill();
  }, readyMs);
  const line = await new Promise<string>((resolve, reject) => {
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      const end = stdout.indexOf("\n");
      if (end !== -1) resolve(stdout.slice(0, end));
    });
    void started.exited.then(({ code, signal, spawnError }) => {
      const why = timedOut ? `child printed no line within ${String(readyMs)} ms and was killed` : `child exited before its first line (code ${String(code)}, signal ${String(signal)})`;
      reject(new Error(spawnError ?? `${why}: ${stderr}`));
    });
  }).finally(() => { clearTimeout(timer); });
  return { ...started, line, stderr: () => stderr };
}

/**
 * Start the child and close its stdin, stdout, and stderr. It reads
 * end-of-file on stdin and gets EPIPE on its writes, as after its parent died.
 */
export function spawnThenAbandon(spec: ChildSpec): StartedChild {
  const started = start(spec);
  started.child.stdin.destroy();
  started.child.stdout.destroy();
  started.child.stderr.destroy();
  return started;
}
