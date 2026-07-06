/**
 * Shared scan-and-match + filename helpers for connector job cards.
 *
 * Chat and intake connectors both (a) scan `box/jobs` for an existing pending
 * job to dedupe/append onto, and (b) mint a fresh timestamped job-card
 * filename. Those two mechanical parts live here; the create-vs-append policy
 * (chat creates a new job per thread; intake appends items to an existing one)
 * stays in each connector's own module.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseFrontmatterObject } from "../cards/index.js";
import { getBoxTimeISO } from "../lib/time.js";

/**
 * Build a job-card filename: `<timestamp>-<stem>.<extension>`, where the
 * timestamp is the box's current time as `YYYY-MM-DDTHH-MM-SS` (colons and the
 * fractional dot replaced with dashes so it's filesystem-safe). `extension`
 * is the full suffix after the stem, e.g. `chat.job.card` or `intake.job.card`.
 */
export function timestampedJobFilename(
  boxRoot: string,
  { stem, extension }: { stem: string; extension: string }
): string {
  const timestamp = getBoxTimeISO(boxRoot).replace(/[.:]/g, "-").slice(0, 19);
  return `${timestamp}-${stem}.${extension}`;
}

/**
 * Scan a jobs directory for the first card whose filename ends with `suffix`
 * and whose parsed frontmatter satisfies `match`. Returns the absolute path,
 * or `null` when none matches (including a missing jobs directory).
 *
 * A missing directory is silent (no jobs yet); any other readdir/read error is
 * logged and the entry skipped, so one hand-mangled card can't hide the rest.
 */
export async function findPendingJobCard(options: {
  jobsDir: string;
  suffix: string;
  match: (fields: Record<string, unknown>) => boolean;
}): Promise<string | null> {
  const { jobsDir, suffix, match } = options;
  let entries: string[];
  try {
    entries = await fs.readdir(jobsDir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`findPendingJobCard: could not read ${jobsDir}, assuming no existing job:`, e);
    }
    return null;
  }

  for (const entry of entries) {
    if (!entry.endsWith(suffix)) continue;
    const filePath = path.join(jobsDir, entry);
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`findPendingJobCard: could not read ${filePath}, skipping:`, e);
      }
      continue;
    }
    const fields = parseFrontmatterObject(content);
    if (fields === null) continue;
    if (match(fields)) return filePath;
  }
  return null;
}
