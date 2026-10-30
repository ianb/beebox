/**
 * Shell execution helper for procedure steps.
 *
 * Executes shell commands via bash in the box root directory,
 * with the CHECK_SKIP environment variable set.
 */

import { execa, type ExecaError } from "execa";
import { buildScriptEnv } from "../script-env/core.js";

/** Exit code that signals "skip this step" */
export const CHECK_SKIP_CODE = 75;

/**
 * Per-run context the procedure's caller holds in this process's env, passed
 * to each shell step by name. The step's env is otherwise the agent profile
 * (`buildScriptEnv`); none of these is a credential.
 *
 * - `TRIAGE_ITEMS`: the bucket a handler procedure works on, set by
 *   `core/handle.ts` around the run.
 * - `BBX_CHAT_SESSION_ID`, `BBX_CHAT_SESSION_ID_FILE`: the chat that ran
 *   `bbx procedure run`, so a step's `bbx chat …` calls attribute to it
 *   (`core/chat/session/id-file.ts`).
 * - `CODEX_THREAD_ID`: the same for a Codex chat (`cli/commands/session/command.ts`).
 */
const PROCEDURE_RUN_ENV = ["TRIAGE_ITEMS", "BBX_CHAT_SESSION_ID", "BBX_CHAT_SESSION_ID_FILE", "CODEX_THREAD_ID"] as const;

function procedureRunEnv(): Record<string, string> {
  return Object.fromEntries(PROCEDURE_RUN_ENV.flatMap((name) => {
    const value = process.env[name];
    return value === undefined ? [] : [[name, value]];
  }));
}

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
    // `bbx` is on PATH here just like it is for the reactor/agent — on the server
    // `bbx` happens to be on the user's PATH, but in a dev worktree it isn't, and
    // procedure shells (e.g. an agent-migration's `bbx view check` gate) must run
    // the same in both. buildScriptEnv prepends beebox's bin/ to PATH.
    const env = await buildScriptEnv(boxRoot, { ...procedureRunEnv(), CHECK_SKIP: String(CHECK_SKIP_CODE) });
    const { stdout, stderr } = await execa("bash", ["-c", wrappedScript], {
      cwd: boxRoot,
      env,
      // execa merges process.env under `env` by default, which would hand the
      // script every server credential the allowlist withheld. Per-run context
      // the step needs is passed by name above (PROCEDURE_RUN_ENV).
      extendEnv: false,
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
