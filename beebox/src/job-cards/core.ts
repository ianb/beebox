/**
 * The job-card filename helper shared by job writers: a fresh timestamped
 * name. The create-vs-append policy stays in each writer's own module.
 */

import { getBoxTimeISO } from "../lib/time.js";

/**
 * Build a job-card filename: `<timestamp>-<stem>[-<suffix>].<extension>`,
 * where the timestamp is the box's current time as `YYYY-MM-DDTHH-MM-SS`
 * (colons and the fractional dot replaced with dashes so it's
 * filesystem-safe). `extension` is the full suffix after the stem, e.g.
 * `chat.job.card` or `intake.job.card`. `suffix` keeps two jobs of one stem
 * created in the same second apart; the stamp stays first, so discovery still
 * reads the job's age from it.
 */
export function timestampedJobFilename(
  boxRoot: string,
  { stem, extension, suffix }: { stem: string; extension: string; suffix?: string | undefined }
): string {
  const timestamp = getBoxTimeISO(boxRoot).replace(/[.:]/g, "-").slice(0, 19);
  return `${timestamp}-${stem}${suffix === undefined ? "" : `-${suffix}`}.${extension}`;
}

