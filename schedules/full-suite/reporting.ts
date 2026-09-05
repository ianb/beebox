/** The run's one report: a `bin/schedules` alert, or `done` when suppressed. */
import * as path from "node:path";

import { execa } from "execa";

import { alertFingerprint, shouldSuppressAlert } from "./trust.js";
import { REPO_ROOT } from "./repo.js";
import { readLastAlert, writeLastAlert } from "./state.js";

const SCHEDULES_CLI = path.join(REPO_ROOT, "bin", "schedules");

/**
 * `bin/schedules alert|done`, which handle `SCHEDULE_DRY_RUN` themselves.
 * Returns whether the CLI accepted it; a failed report is loud but not fatal —
 * the runner's own ended-without-reporting alert is the backstop.
 */
export async function report(args: string[]): Promise<boolean> {
  const result = await execa(SCHEDULES_CLI, args, { stdout: "inherit", stderr: "inherit", reject: false });
  const delivered = result.exitCode === 0;
  if (!delivered) {
    process.stdout.write(`full-suite: bin/schedules ${args[0] ?? ""} failed (exit ${String(result.exitCode)}).\n`);
  }
  return delivered;
}

async function alert(input: { title: string; message: string; priority: string }): Promise<boolean> {
  return report(["alert", "--priority", input.priority, "--title", input.title, "--message", input.message]);
}

/**
 * One report per run, with repeat suppression: an unchanged condition inside
 * the repeat window reports `done` instead of re-raising the same alert. The
 * 08-30 load event raised the identical baseline-red alert eight hourly runs
 * in a row; the record is durable, the repetition was pure noise.
 */
export async function alertOnce(input: {
  kind: string;
  files: readonly string[];
  title: string;
  message: string;
  priority: string;
}): Promise<void> {
  const fingerprint = alertFingerprint({ kind: input.kind, files: input.files });
  const previous = await readLastAlert();
  if (shouldSuppressAlert({ previous, fingerprint, now: new Date() })) {
    process.stdout.write(`full-suite: unchanged condition (${input.kind}); alert suppressed, reporting done.\n`);
    await report(["done"]);
    return;
  }
  // Suppression state only records a DELIVERED alert: suppressing the next
  // run's alert because this one failed to send would hide the condition.
  if (await alert(input)) {
    await writeLastAlert({ fingerprint, raisedAt: new Date().toISOString() });
  }
}
