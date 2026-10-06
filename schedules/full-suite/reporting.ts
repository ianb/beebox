/** The run's one report: a `bin/schedules` alert under a condition, or `done`. */
import * as path from "node:path";

import { execa } from "execa";

import { alertCondition, type AlertKind } from "./trust.js";
import { REPO_ROOT } from "./repo.js";

const SCHEDULES_CLI = path.join(REPO_ROOT, "bin", "schedules");

/**
 * `bin/schedules alert|done|resolve`, which handle `SCHEDULE_DRY_RUN`
 * themselves. Returns whether the CLI accepted it; a failed report is loud but
 * not fatal — the runner's own ended-without-reporting alert is the backstop.
 */
export async function report(args: string[]): Promise<boolean> {
  const result = await execa(SCHEDULES_CLI, args, { stdout: "inherit", stderr: "inherit", reject: false });
  const delivered = result.exitCode === 0;
  if (!delivered) {
    process.stdout.write(`full-suite: bin/schedules ${args[0] ?? ""} failed (exit ${String(result.exitCode)}).\n`);
  }
  return delivered;
}

/**
 * Raise this run's finding under its condition. The store turns a repeat into
 * an update of the open alert, so an unchanged condition is one record with a
 * count rather than an alert per hourly run.
 *
 * `verdict` says whether this run judged the code. A run that did (red,
 * flakes) is the current truth, so every other condition it did not report
 * has cleared. A run that did not (host under load, environment failure)
 * leaves earlier conditions alone.
 */
export async function raiseCondition(input: {
  kind: AlertKind;
  culprits: readonly string[];
  priority: "important" | "normal" | "fyi";
  title: string;
  message: string;
  verdict: boolean;
}): Promise<void> {
  const condition = alertCondition({ kind: input.kind, culprits: input.culprits });
  await report([
    "alert", "--priority", input.priority, "--condition", condition, "--title", input.title, "--message", input.message,
  ]);
  if (input.verdict) await report(["resolve", "--except", condition]);
}
