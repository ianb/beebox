/**
 * Core logic for finishing a job — deleting the job card and committing.
 *
 * Extracted from CLI `finish` command so it can be called programmatically
 * (e.g., by the reactor after trampolining a procedure job).
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { stageFiles, commit } from "../cli/lib/git.js";

export interface FinishJobParams {
  boxRoot: string;
  /** Job card path relative to boxRoot (e.g., "box/jobs/foo.intake.job.card") */
  jobRelPath: string;
}

export async function finishJob(params: FinishJobParams): Promise<void> {
  const { boxRoot, jobRelPath } = params;
  const absPath = path.join(boxRoot, jobRelPath);

  // Read the job card for context before deleting
  let description = "";
  let jobType = "";
  try {
    const content = await fs.readFile(absPath, "utf-8");
    const descMatch = content.match(/<description>(.*?)<\/description>/s);
    if (descMatch) {
      description = descMatch[1]!.trim();
    }
    const parts = path.basename(jobRelPath).split(".");
    // parts: ["foo", "intake", "job", "card"]
    if (parts.length >= 4) {
      jobType = parts[parts.length - 3]!; // "intake"
    }
  } catch {
    // File might already be gone, that's ok
  }

  // Delete the job file
  try {
    await fs.unlink(absPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return; // Already gone
    }
    throw err;
  }

  // Stage and commit the deletion
  await stageFiles(boxRoot, [jobRelPath]);

  const commitMsg = description
    ? `Finish job: ${description}`
    : `Finish ${jobType || "unknown"} job`;

  const trailers: Record<string, string> = {};
  if (jobType) {
    trailers["Job-Type"] = jobType;
  }

  await commit(boxRoot, { message: commitMsg, trailers });
}
