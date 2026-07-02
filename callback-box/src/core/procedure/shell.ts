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
    const execError = error as ExecaError;
    const exitCode = execError.exitCode ?? 1;
    return {
      exitCode,
      stdout: (execError.stdout as string ?? "").trimEnd(),
      stderr: (execError.stderr as string ?? "").trimEnd(),
      skipped: exitCode === CHECK_SKIP_CODE,
    };
  }
}
