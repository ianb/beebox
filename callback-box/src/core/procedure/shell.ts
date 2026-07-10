/**
 * Shell execution helper for procedure steps.
 *
 * Executes shell commands via bash in the box root directory,
 * with the CHECK_SKIP environment variable set.
 */

import { execa, type ExecaError } from "execa";
import { buildScriptEnv } from "../script-env.js";

/** Exit code that signals "skip this step" */
export const CHECK_SKIP_CODE = 75;

/**
 * Real guard for `ExecaError` — execa doesn't export one, but `error.name` is
 * a readonly `'ExecaError'` literal on the class, so a plain instanceof +
 * name check narrows soundly without a cast.
 */
function isExecaError(error: unknown): error is ExecaError {
  return error instanceof Error && error.name === "ExecaError";
}

export interface ShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** True if the shell exited with CHECK_SKIP_CODE */
  skipped: boolean;
}

/**
 * Execute a shell script via bash in the box root.
 *
 * Sets the CHECK_SKIP environment variable so scripts can use
 * `exit $CHECK_SKIP` to signal "nothing to do, skip this step".
 */
export async function runShell(
  boxRoot: string,
  script: string
): Promise<ShellResult> {
  try {
    // Strict mode: -e (exit on error), -u (error on unset variable, catching
    // typo'd var names that would otherwise silently expand to empty), and
    // pipefail (a failing command in a pipeline fails the whole pipe).
    const wrappedScript = `set -euo pipefail\n${script}`;
    // Use the box subprocess env (buildScriptEnv) rather than raw process.env so
    // `cb` is on PATH here just like it is for the reactor/agent — on the server
    // `cb` happens to be on the user's PATH, but in a dev worktree it isn't, and
    // procedure shells (e.g. an agent-migration's `cb view check` gate) must run
    // the same in both. buildScriptEnv prepends callback-box's bin/ to PATH.
    const env = await buildScriptEnv(boxRoot, { CHECK_SKIP: String(CHECK_SKIP_CODE) });
    const { stdout, stderr } = await execa("bash", ["-c", wrappedScript], {
      cwd: boxRoot,
      env,
      maxBuffer: 1024 * 1024, // 1MB
    });

    return {
      exitCode: 0,
      stdout: stdout.trimEnd(),
      stderr: stderr.trimEnd(),
      skipped: false,
    };
  } catch (error) {
    if (!isExecaError(error)) throw error;
    const exitCode = error.exitCode ?? 1;
    // stdout/stderr are typed string | string[] | Uint8Array | undefined in
    // general (execa's type widens over every stdio config); this call uses
    // plain string stdio, but narrow with a runtime check rather than an `as
    // string` cast that would silently lie about the other possibilities.
    const stdout = typeof error.stdout === "string" ? error.stdout : "";
    const stderr = typeof error.stderr === "string" ? error.stderr : "";
    return {
      exitCode,
      stdout: stdout.trimEnd(),
      stderr: stderr.trimEnd(),
      skipped: exitCode === CHECK_SKIP_CODE,
    };
  }
}
