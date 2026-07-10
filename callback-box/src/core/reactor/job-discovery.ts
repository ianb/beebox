/**
 * Job card discovery — scans box/jobs/ for pending job cards.
 *
 * Job cards have the suffix `.job.card` (optionally `.TYPE.job.card`
 * for typed jobs like chat). Priority and source are read from the card's
 * YAML frontmatter (`priority:`, `source:`). When a sourceFilter is
 * provided, jobs whose source does not match are dropped — used by
 * `cb wakeup --connector X` to scope the reactor to just the jobs that the
 * same partial run produced.
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { readCardFrontmatter } from "../card-io.js";
import type { JobCardInfo } from "./types.js";
import { errnoCode } from "../../lib/error-guards.js";

export async function findJobCards(
  jobsDir: string,
  options?: { typeFilter?: string | undefined; sourceFilter?: string | undefined }
): Promise<JobCardInfo[]> {
  options = options ?? {};
  const { typeFilter, sourceFilter } = options;
  let entries: string[];
  try {
    entries = await fs.readdir(jobsDir, { recursive: true });
  } catch (e) {
    // jobs/ may not exist yet (fresh box, or no jobs produced) — treat as
    // no pending jobs rather than an error.
    if (errnoCode(e) !== "ENOENT") {
      console.debug(`findJobCards: cannot read ${jobsDir}, treating as empty:`, e);
    }
    return [];
  }

  const suffix = typeFilter ? `.${typeFilter}.job.card` : ".job.card";
  const jobFiles = entries.filter((e) => e.endsWith(suffix));
  const results: JobCardInfo[] = [];

  for (const file of jobFiles) {
    let priority: "normal" | "low" = "normal";
    let source: string | undefined;
    try {
      const content = await fs.readFile(path.join(jobsDir, file), "utf-8");
      const fm = readCardFrontmatter(content);
      if (fm) {
        if (fm["priority"] === "low") priority = "low";
        if (typeof fm["source"] === "string") source = fm["source"];
      }
    } catch (e) {
      // Can't read this card — default to normal priority, no source. The job
      // is still surfaced; whatever processes it will hit the same read error.
      console.debug(`findJobCards: cannot read ${file}, using defaults:`, e);
    }
    if (sourceFilter !== undefined && source !== sourceFilter) continue;
    results.push({ file, priority });
  }

  // Sort: normal-priority first, low-priority last
  results.sort((a, b) => {
    if (a.priority === b.priority) return 0;
    return a.priority === "normal" ? -1 : 1;
  });

  return results;
}
