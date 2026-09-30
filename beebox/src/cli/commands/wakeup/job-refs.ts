/**
 * Which inbox items existing job cards already hold, for the wakeup's
 * intake-job step (`steps.ts`), and the connector-scoped move of items out of
 * intake jobs the scoped reactor would skip.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { readCardFrontmatter, collectRefs } from "../../../core/card-io.js";
import { removeItemsFromIntakeJob } from "../../../job-cards/intake-utils.js";
import { getBoxDir } from "../../../lib/paths/core.js";

/**
 * Collect item refs from existing job cards, so the inbox scan can skip items
 * that are already tracked. Refs are read from the job's YAML frontmatter
 * (`items: [{ref}]`, `thread: {ref}`, …).
 *
 * `held` refs count as jobbed. Unscoped (`connectorName` undefined), that is
 * every job's refs. Scoped, an intake job the run's reactor will skip (its
 * `connector` differs, `job-discovery.ts`'s filter) instead lists its refs in
 * `takeable`, keyed by ref, with the jobs holding each; other job types stay
 * `held`, since their refs are not triage items to move.
 */
export async function collectExistingJobRefs(
  boxRoot: string,
  connectorName: string | undefined,
): Promise<{ held: Set<string>; takeable: Map<string, string[]> }> {
  const jobsDir = getBoxDir(boxRoot, "jobs");
  const held = new Set<string>();
  const takeable = new Map<string, string[]>();
  let jobFiles: string[];
  try {
    jobFiles = await fs.readdir(jobsDir);
  } catch (_e) {
    // No jobs dir yet (ENOENT) — treat as no existing refs.
    return { held, takeable };
  }
  for (const file of jobFiles) {
    // Matches current `-job.card` types (intake-job, chat-job, ...) and
    // legacy dotted names like `.intake.job.card`.
    if (!file.endsWith("job.card")) continue;
    const fm = readCardFrontmatter(await fs.readFile(path.join(jobsDir, file), "utf-8"));
    if (!fm) continue;
    const skipped = connectorName !== undefined && fm["connector"] !== connectorName && file.endsWith(".intake.job.card");
    for (const ref of collectRefs(fm)) {
      if (!skipped) held.add(ref);
      else takeable.set(ref, [...(takeable.get(ref) ?? []), path.relative(boxRoot, path.join(jobsDir, file))]);
    }
  }
  return { held, takeable };
}

/** Remove newly jobbed `items` from the skipped intake jobs that held them;
 *  returns the changed or deleted job paths to commit. */
export async function releaseTakenItems(
  boxRoot: string,
  { items, takeable }: { items: string[]; takeable: Map<string, string[]> },
): Promise<string[]> {
  const refsByJob = new Map<string, string[]>();
  for (const ref of items) {
    for (const job of takeable.get(ref) ?? []) refsByJob.set(job, [...(refsByJob.get(job) ?? []), ref]);
  }
  const changed: string[] = [];
  for (const [jobRelPath, refs] of refsByJob) {
    if (await removeItemsFromIntakeJob({ boxRoot, jobRelPath, refs })) changed.push(jobRelPath);
  }
  return changed;
}
