/**
 * Implementation of the heavier `cb wakeup` steps that the command's
 * action handler orchestrates: preprocessing inbox items, cleaning up
 * stale jobs whose refs all point at deleted files, and creating intake
 * jobs for unjobbed inbox items.
 *
 * These live next to wakeup.ts so the command file stays focused on
 * sequencing the steps and printing progress.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type Connector } from "../../connectors/index.js";
import { runPreActions } from "../../core/preactions/index.js";
import { createLoader } from "../lib/loader.js";
import { getSystemState } from "../../core/state.js";
import { stageAll, stageFiles, commit, getStatus } from "../lib/git.js";
import { createNewIntakeJob } from "../../connectors/intake-utils.js";

/**
 * Run preprocessors on all inbox items (transcription, etc.).
 * Returns the number of items that were preprocessed.
 */
export async function runPreprocessors(boxRoot: string): Promise<number> {
  const state = await getSystemState(boxRoot);
  if (state.inbox.length === 0) return 0;

  const loader = await createLoader(boxRoot);
  const actionNotes: string[] = [];

  for (const item of state.inbox) {
    try {
      const results = await runPreActions({
        boxRoot,
        loader,
        cardPath: item.path,
      });

      for (const r of results) {
        if (r.result.modified && r.result.message) {
          actionNotes.push(`${item.name}: ${r.result.message}`);
        } else if (r.result.error) {
          actionNotes.push(`${item.name}: ${r.name} failed`);
        }
      }
    } catch (error) {
      console.error(`  Error processing ${item.relativePath}: ${(error as Error).message}`);
    }
  }

  if (actionNotes.length === 0) return 0;

  // Commit pre-action changes
  const status = await getStatus(boxRoot);
  if (!status.clean) {
    await stageAll(boxRoot);
    const lines = [
      `Pre-actions: ${actionNotes.length} item${actionNotes.length === 1 ? "" : "s"}`,
      "",
    ];
    for (const note of actionNotes.slice(0, 5)) {
      lines.push(`- ${note}`);
    }
    if (actionNotes.length > 5) {
      lines.push(`  + ${actionNotes.length - 5} more`);
    }
    await commit(boxRoot, {
      message: lines.join("\n"),
      trailers: {
        "Triggered-By": "cb wakeup",
        Phase: "pre-actions",
      },
    });
  }

  return actionNotes.length;
}

/**
 * Clean up stale job cards whose referenced files no longer exist.
 * This catches jobs that were never finished — the agent ran out of turns,
 * or the items were processed through another path. The job is deleted and
 * committed with an error-indicating message so it can be investigated later.
 */
export async function cleanupStaleJobs(boxRoot: string): Promise<number> {
  const jobsDir = path.join(boxRoot, "box/jobs");
  let jobFiles: string[];
  try {
    jobFiles = await fs.readdir(jobsDir);
  } catch (_e) {
    // No jobs dir yet (ENOENT) — nothing to clean up.
    return 0;
  }

  const staleJobs: Array<{ relPath: string; totalRefs: number }> = [];

  for (const file of jobFiles) {
    if (!file.endsWith(".job.card")) continue;
    const filePath = path.join(jobsDir, file);
    const relPath = path.relative(boxRoot, filePath);

    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch (e) {
      console.warn(`  Skipping unreadable job file ${relPath}:`, e);
      continue;
    }

    // Only clean up pending jobs
    if (!content.includes("status=\"pending\"")) continue;

    // Extract all ref="..." from the job
    const refs: string[] = [];
    for (const match of content.matchAll(/ref="([^"]+)"/g)) {
      const ref = match[1]!;
      // Skip URL refs (not file paths)
      if (ref.startsWith("http://") || ref.startsWith("https://")) continue;
      refs.push(ref);
    }

    if (refs.length === 0) continue;

    // Check if ALL referenced files are gone
    let allMissing = true;
    for (const ref of refs) {
      try {
        await fs.access(path.join(boxRoot, ref));
        allMissing = false;
        break;
      } catch (_e) {
        // access() throwing IS the test result: this ref's file is gone.
        // Keep allMissing true and check the next ref; the error itself
        // carries no actionable info beyond "not accessible".
      }
    }

    if (allMissing) {
      staleJobs.push({ relPath, totalRefs: refs.length });
    }
  }

  if (staleJobs.length === 0) return 0;

  // Delete stale jobs and commit
  const deletedPaths: string[] = [];
  for (const job of staleJobs) {
    const fullPath = path.join(boxRoot, job.relPath);
    await fs.unlink(fullPath);
    deletedPaths.push(job.relPath);
  }

  await stageFiles(boxRoot, deletedPaths);
  const summary = staleJobs
    .map((j) => `  ${j.relPath} (${j.totalRefs} dead refs)`)
    .join("\n");
  await commit(boxRoot, {
    message: `Clean up ${staleJobs.length} stale job(s) with all dead references\n\nThese jobs were never completed by the agent — all referenced\nfiles have been processed or removed through other paths.\n\n${summary}`,
    trailers: {
      "Triggered-By": "cb wakeup",
      Phase: "stale-job-cleanup",
    },
  });

  return staleJobs.length;
}

/**
 * Scan inbox for items not referenced by any pending job and create
 * intake jobs for them. Returns the number of items covered.
 *
 * Under a full wakeup, scans all of `box/inbox/` (skipping subdirs that
 * have their own pipelines) and tags intake jobs with `source="wakeup"`
 * / `source="wakeup-captures"`. Under a connector-scoped wakeup, scans
 * only `connector.inboxPaths` and tags jobs with the connector's name
 * as `source`, so the reactor's source filter routes them back to the
 * same partial run.
 */
export async function createIntakeJobsForUnjobbed(
  boxRoot: string,
  options?: { connector?: Connector }
): Promise<number> {
  options = options ?? {};
  const { connector } = options;

  // Subdirectories with their own pipelines — skip these on a full scan.
  const EXCLUDED_SUBDIRS = ["feedback"];

  const existingRefs = await collectExistingJobRefs(boxRoot);
  const unjobbedItems = await findUnjobbedInboxItems(boxRoot, {
    connector,
    existingRefs,
    excludedSubdirs: EXCLUDED_SUBDIRS,
  });
  if (unjobbedItems.length === 0) return 0;

  // Group by type for priority assignment
  const lowPriority = unjobbedItems.filter(
    (p) => p.includes(".capture-session.card") || p.includes(".image.card") || p.includes(".audio.card")
  );
  const normalPriority = unjobbedItems.filter(
    (p) => !lowPriority.includes(p)
  );

  // Source naming: scoped wakeups use the connector name (so the reactor's
  // source filter picks them up in the same run); full wakeups keep the
  // historical "wakeup" / "wakeup-captures" pair.
  const normalSource = connector ? connector.name : "wakeup";
  const lowSource = connector ? connector.name : "wakeup-captures";

  const jobPaths: string[] = [];

  if (normalPriority.length > 0) {
    await createBatchedIntakeJobs(boxRoot, {
      items: normalPriority,
      source: normalSource,
      priority: "normal",
      label: "inbox item",
      jobPaths,
    });
  }

  if (lowPriority.length > 0) {
    await createBatchedIntakeJobs(boxRoot, {
      items: lowPriority,
      source: lowSource,
      priority: "low",
      label: "capture item",
      jobPaths,
    });
  }

  if (jobPaths.length > 0) {
    await stageFiles(boxRoot, jobPaths);
    await commit(boxRoot, {
      message: `Create intake jobs for ${unjobbedItems.length} unjobbed inbox item(s)`,
      trailers: {
        "Triggered-By": "cb wakeup",
        Phase: "intake-jobs",
      },
    });
  }

  return unjobbedItems.length;
}

/**
 * Collect every item ref from existing job cards, so the inbox scan can
 * skip items that are already tracked. Handles both card generations:
 * YAML frontmatter `- ref: path` lines and legacy XML `ref="path"`
 * attributes.
 */
async function collectExistingJobRefs(boxRoot: string): Promise<Set<string>> {
  const jobsDir = path.join(boxRoot, "box/jobs");
  const existingRefs = new Set<string>();
  try {
    const jobFiles = await fs.readdir(jobsDir);
    for (const file of jobFiles) {
      // Matches current `-job.card` types (intake-job, chat-job, ...) and
      // legacy dotted names like `.intake.job.card`.
      if (!file.endsWith("job.card")) continue;
      const content = await fs.readFile(path.join(jobsDir, file), "utf-8");
      for (const match of content.matchAll(/ref="([^"]+)"/g)) {
        existingRefs.add(match[1]!);
      }
      for (const match of content.matchAll(/^\s*-?\s*ref:\s*(.+?)\s*$/gm)) {
        existingRefs.add(stripMatchingQuotes(match[1]!));
      }
    }
  } catch (_e) {
    // No jobs dir yet (ENOENT) — treat as no existing refs.
  }
  return existingRefs;
}

/** Strip one pair of surrounding quotes a YAML stringifier may have added. */
function stripMatchingQuotes(value: string): string {
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Walk the inbox (or a connector's declared inbox paths) and return the
 * relative paths of `.card` files not already referenced by a job.
 */
async function findUnjobbedInboxItems(
  boxRoot: string,
  options: { connector?: Connector | undefined; existingRefs: Set<string>; excludedSubdirs: string[] }
): Promise<string[]> {
  const { connector, existingRefs, excludedSubdirs } = options;
  const unjobbedItems: string[] = [];

  async function scanDir(dir: string, atInboxRoot: boolean): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (_e) {
      // Directory doesn't exist (e.g. a connector inboxPath not yet
      // created) — nothing to scan here.
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const relPath = path.relative(boxRoot, fullPath);
      const stat = await fs.stat(fullPath);

      if (stat.isDirectory()) {
        // Skip excluded subdirectories at the inbox root level (full scan only)
        if (atInboxRoot && excludedSubdirs.includes(entry)) continue;
        await scanDir(fullPath, false);
      } else if (entry.endsWith(".card") && !existingRefs.has(relPath)) {
        unjobbedItems.push(relPath);
      }
    }
  }

  if (connector) {
    // Scoped scan: only the connector's declared inbox paths.
    for (const rel of connector.inboxPaths) {
      await scanDir(path.join(boxRoot, rel), false);
    }
  } else {
    await scanDir(path.join(boxRoot, "box/inbox"), true);
  }

  return unjobbedItems;
}

/**
 * Create batched intake job files (each batch its own file so the agent
 * can finish each within its turn limit) and append their paths to
 * `jobPaths`.
 */
async function createBatchedIntakeJobs(
  boxRoot: string,
  opts: { items: string[]; source: string; priority: "normal" | "low"; label: string; jobPaths: string[] }
): Promise<void> {
  const { items } = opts;
  const INTAKE_BATCH_SIZE = 10;
  for (let i = 0; i < items.length; i += INTAKE_BATCH_SIZE) {
    const batch = items.slice(i, i + INTAKE_BATCH_SIZE);
    const jobPath = await createNewIntakeJob({
      boxRoot,
      source: opts.source,
      items: batch,
      priority: opts.priority,
      description: `Triage ${batch.length} ${opts.label}${batch.length === 1 ? "" : "s"}`,
    });
    opts.jobPaths.push(jobPath);
  }
}
