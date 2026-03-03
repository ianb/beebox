/**
 * Shell execution helper for procedure steps.
 *
 * Executes shell commands via bash in the box root directory,
 * with the CHECK_SKIP environment variable set.
 */

import { execa, type ExecaError } from "execa";

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
    const { stdout, stderr } = await execa("bash", ["-c", script], {
      cwd: boxRoot,
      env: {
        ...process.env,
        CHECK_SKIP: String(CHECK_SKIP_CODE),
      },
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
