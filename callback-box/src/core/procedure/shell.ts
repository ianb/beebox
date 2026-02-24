/**
 * Shell execution helper for procedure steps.
 *
 * Executes shell commands via bash in the box root directory,
 * with the CHECK_SKIP environment variable set.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
    const { stdout, stderr } = await execFileAsync("bash", ["-c", script], {
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
  } catch (error: unknown) {
    const execError = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
      message: string;
    };

    const exitCode = execError.code ?? 1;
    return {
      exitCode,
      stdout: (execError.stdout ?? "").trimEnd(),
      stderr: (execError.stderr ?? "").trimEnd(),
      skipped: exitCode === CHECK_SKIP_CODE,
    };
  }
}
