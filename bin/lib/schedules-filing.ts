/**
 * `bin/schedules file-standing`: a condition that has stayed open for a week
 * becomes an issue, so it stops repeating and lands in the work queue.
 *
 * Filed into `private-issues/`, never the public queue: alert text names real
 * boxes and paths. Run daily by `schedules/alert-filing/`, not by the tick, so
 * the git work and the private-issues lock wait stay out of the scheduler.
 *
 * Design: beebox/docs/plans/schedule-alert-signal.md (Track B).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execa } from "execa";

import { errnoCode } from "../../beebox/src/lib/error-guards.js";
import type { Alert } from "./schedules.js";
import { readAllAlerts, writeAlert } from "./schedules-store.js";
import { FILE_AFTER_MS, FILING_RETRY_MS } from "./schedules-alert-lifecycle.js";

/** Open conditions a week old, not yet filed, and not given up on. */
export function standingToFile(alerts: readonly Alert[], nowMs: number): Alert[] {
  return alerts.filter((alert) =>
    alert.state === "open"
    && alert.condition !== null
    && alert.priority !== "fyi"
    && alert.issue === null
    && nowMs - Date.parse(alert.createdAt) >= FILE_AFTER_MS
    && (alert.filingFailedSince === null || nowMs - Date.parse(alert.filingFailedSince) < FILING_RETRY_MS));
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 60);
}

/** The issue file for one standing condition, relative to the private-issues
 *  root. It says what the record knows and proposes no fix. */
export function renderStandingIssue(alert: Alert, today: string): { relPath: string; text: string } {
  const condition = alert.condition ?? "";
  const since = alert.createdAt.slice(0, 10);
  const text = [
    "---",
    `title: ${JSON.stringify(`${alert.workstream}: ${alert.title} (standing since ${since})`)}`,
    "workstream: unattached",
    "area: router",
    "labels: [schedules]",
    `priority: ${alert.priority}`,
    "filed-by: agent",
    "discovered-by: agent",
    `discovered-in: main — schedule ${alert.workstream}, condition ${condition}`,
    "---",
    "",
    `The \`${alert.workstream}\` schedule has reported the condition \`${condition}\` since`,
    `${since}: ${String(alert.occurrences)} time${alert.occurrences === 1 ? "" : "s"}, last at ${alert.lastSeenAt}.`,
    "A condition open for a week is filed here instead of repeating. Its alert",
    "stays open until the schedule resolves the condition; the daily digest then",
    "says this issue can be closed.",
    "",
    "## Latest report",
    "",
    `**${alert.title}**`,
    "",
    alert.message,
    ...(alert.details === null ? [] : ["", alert.details]),
    "",
  ].join("\n");
  return { relPath: path.join("bugs", `${today}-schedule-${slug(`${alert.workstream}-${condition}`)}.md`), text };
}

/** Writes and commits one issue file inside the private-issues repo. */
export type CommitIssue = (issue: { relPath: string; text: string }) => Promise<void>;

/** Why an issue could not be filed; stored on the alert as `filingError`. */
class PrivateIssuesUnavailableError extends Error {
  constructor(readonly root: string) {
    super(`private-issues is not mounted at ${root}`);
    this.name = "PrivateIssuesUnavailableError";
  }
}

class IssueCommitError extends Error {
  constructor(readonly output: string) {
    super(`private-issues commit failed: ${output.slice(-500)}`);
    this.name = "IssueCommitError";
  }
}

/** The real `CommitIssue`: the file is new, so writing it needs no lock; the
 *  git add and commit run under the private-issues mutation lock, with a
 *  bounded wait so a held lock fails this run rather than hanging it. */
export function privateIssuesCommitter(repoRoot: string): CommitIssue {
  const root = path.join(repoRoot, "private-issues");
  return async (issue) => {
    try {
      if (!(await fs.stat(root)).isDirectory()) throw new PrivateIssuesUnavailableError(root);
    } catch (e) {
      if (errnoCode(e) === "ENOENT") throw new PrivateIssuesUnavailableError(root);
      throw e;
    }
    await fs.writeFile(path.join(root, issue.relPath), issue.text, { flag: "wx" });
    const script = 'git -C "$1" add -- "$2" && git -C "$1" commit -q -m "$3" -- "$2"';
    const committed = await execa(path.join(repoRoot, "bin", "private-issues"), [
      "with-lock", repoRoot, "sh", "-c", script, "file-standing", root, issue.relPath,
      `File standing schedule condition: ${path.basename(issue.relPath, ".md")}`,
    ], { reject: false, all: true, env: { PRIVATE_ISSUES_LOCK_MAX_TRIES: "60" } });
    if (committed.exitCode !== 0) {
      await fs.rm(path.join(root, issue.relPath), { force: true });
      throw new IssueCommitError(committed.all);
    }
  };
}

export interface FilingOutcome {
  filed: Alert[];
  failed: Alert[];
}

/** File every standing condition that is due; record each outcome on its alert. */
export async function fileStanding(
  storeRoot: string,
  input: { now: Date; commitIssue: CommitIssue },
): Promise<FilingOutcome> {
  const at = input.now.toISOString();
  const outcome: FilingOutcome = { filed: [], failed: [] };
  for (const alert of standingToFile(await readAllAlerts(storeRoot), input.now.getTime())) {
    const issue = renderStandingIssue(alert, at.slice(0, 10));
    try {
      await input.commitIssue(issue);
      const filed = { ...alert, issue: path.join("private-issues", issue.relPath), filingFailedSince: null, filingError: null };
      await writeAlert(storeRoot, filed);
      outcome.filed.push(filed);
    } catch (e) {
      const failed = { ...alert, filingFailedSince: alert.filingFailedSince ?? at, filingError: e instanceof Error ? e.message : String(e) };
      await writeAlert(storeRoot, failed);
      outcome.failed.push(failed);
    }
  }
  return outcome;
}
