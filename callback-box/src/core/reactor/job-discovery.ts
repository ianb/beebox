/**
 * Job card discovery — scans box/jobs/ for pending job cards.
 *
 * Job cards are XML files with the suffix `.job.card` (optionally
 * `.TYPE.job.card` for typed jobs like chat). Priority is extracted
 * from the card's `priority="low|normal"` attribute.
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { JobCardInfo } from "./types.js";

export async function findJobCards(jobsDir: string, typeFilter?: string): Promise<JobCardInfo[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(jobsDir, { recursive: true });
  } catch {
    return [];
  }

  const suffix = typeFilter ? `.${typeFilter}.job.card` : ".job.card";
  const jobFiles = entries.filter((e) => e.endsWith(suffix));
  const results: JobCardInfo[] = [];

  for (const file of jobFiles) {
    let priority: "normal" | "low" = "normal";
    try {
      const content = await fs.readFile(path.join(jobsDir, file), "utf-8");
      const match = content.match(/priority="(low|normal)"/);
      if (match?.[1] === "low") priority = "low";
    } catch {
      // Can't read — default to normal priority
    }
    results.push({ file, priority });
  }

  // Sort: normal-priority first, low-priority last
  results.sort((a, b) => {
    if (a.priority === b.priority) return 0;
    return a.priority === "normal" ? -1 : 1;
  });

  return results;
}
