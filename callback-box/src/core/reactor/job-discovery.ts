/**
 * Job card discovery — scans box/jobs/ for pending job cards.
 *
 * Job cards are XML files with the suffix `.job.card` (optionally
 * `.TYPE.job.card` for typed jobs like chat). Priority is extracted
 * from the card's `priority="low|normal"` attribute. When a sourceFilter
 * is provided, jobs whose root element's `source` attribute does not
 * match are dropped — used by `cb wakeup --connector X` to scope the
 * reactor to just the jobs that the same partial run produced.
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { JobCardInfo } from "./types.js";

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
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
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
      const priorityMatch = content.match(/priority="(low|normal)"/);
      if (priorityMatch?.[1] === "low") priority = "low";
      // Source attr lives on the root element. The first source="..." in
      // the file is reliable because root attrs precede children.
      const sourceMatch = content.match(/source="([^"]*)"/);
      if (sourceMatch) source = sourceMatch[1];
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
