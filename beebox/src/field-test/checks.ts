/**
 * Hard-assert check scripts (`docs/plans/agent-field-tests.md`, Track 2/4).
 *
 * A scenario item names scripts in its scenario's `checks/`; the harness runs
 * each in the operational box root after the box goes quiet. Exit 0 is a pass.
 * The operator never sees these — they are the spine of the run, independent of
 * whatever the operator believed happened.
 *
 * Scripts are run through `sh`, not executed directly: a check is a small
 * POSIX-sh assertion (see `field-tests/spine/checks/`), and depending on a
 * committed executable bit is a failure mode nobody would diagnose from the
 * report.
 */

import * as path from "node:path";
import { execa } from "execa";
import { errorMessage } from "../lib/error-guards.js";
import type { CheckResult } from "./results.js";

/** How long one check may take. Checks read the box off disk; a check that
 *  takes a minute is hung, not slow. */
const CHECK_TIMEOUT_MS = 60_000;
/** Cap on captured output — a failing `find`-based check can print a lot. */
const OUTPUT_LIMIT = 4000;

function tail(text: string): string {
  return text.length <= OUTPUT_LIMIT ? text : `…${text.slice(-OUTPUT_LIMIT)}`;
}

export interface RunCheckOptions {
  /** The scenario's `checks/` directory. */
  checksDir: string;
  /** Script filename inside it. */
  script: string;
  /** Operational box root — the check's working directory. */
  boxRoot: string;
  /** The run's simulated clock, so a check can reason about "today". */
  env: NodeJS.ProcessEnv;
}

/** Run one check script. Never throws: a check that cannot even be spawned is
 *  a failed check with the reason in `stderr`, which is what the report wants. */
export async function runCheck(options: RunCheckOptions): Promise<CheckResult> {
  const { checksDir, script, boxRoot, env } = options;
  try {
    const result = await execa("sh", [path.join(checksDir, script)], {
      cwd: boxRoot,
      env: { ...process.env, ...env },
      reject: false,
      timeout: CHECK_TIMEOUT_MS,
    });
    return {
      script,
      passed: result.exitCode === 0,
      exitCode: result.exitCode ?? null,
      stdout: tail(result.stdout),
      stderr: tail(result.stderr),
    };
  } catch (e) {
    return { script, passed: false, exitCode: null, stdout: "", stderr: errorMessage(e) };
  }
}
