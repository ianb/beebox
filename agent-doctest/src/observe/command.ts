/**
 * Run a command and observe all of its result as one value for `t.check`:
 * exit code, signal, stdout, and stderr. A test that checks only stdout
 * misses a non-zero exit or an error printed on stderr; checking this whole
 * value does not.
 *
 *     t.check(runCommand(tsxCommand("bin/status.ts", "--json")), {
 *       exitCode: 0, signal: null, stdout: str`ready ${any(String)}\n`, stderr: "",
 *     });
 */

import { spawnSync } from "node:child_process";

export interface CommandResult {
  /** The exit code, or null when a signal ended the process. */
  exitCode: number | null;
  /** The signal that ended the process, or null. */
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Written to the process's stdin. */
  input?: string;
  /** Kill the process after this long. Default 60 s. */
  timeoutMs?: number;
}

/** Thrown when the command could not start at all (not found, not executable). */
export class CommandStartError extends Error {
  constructor(command: string, cause: Error) {
    super(`could not start ${command}: ${cause.message}`, { cause });
    this.name = "CommandStartError";
  }
}

/** Run `argv[0]` with the remaining arguments and wait for it to finish. */
export function runCommand(argv: readonly [string, ...string[]], options: CommandOptions = {}): CommandResult {
  const [command, ...args] = argv;
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: options.timeoutMs ?? 60_000,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.input === undefined ? {} : { input: options.input }),
  });
  if (result.error !== undefined && result.pid === 0) throw new CommandStartError(command, result.error);
  return { exitCode: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr };
}

/**
 * The argv that runs a TypeScript file under tsx with this Node binary. tsx
 * is resolved from agent-doctest's own dependencies by absolute URL, so the
 * command works from any cwd, including a fixture directory outside the repo.
 */
export function tsxCommand(script: string, ...args: string[]): [string, ...string[]] {
  return [process.execPath, "--import", import.meta.resolve("tsx"), script, ...args];
}
