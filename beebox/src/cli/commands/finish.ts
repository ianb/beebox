/**
 * bbx finish <job-file> - Complete a job by deleting its card file.
 *
 * The agent commits its own work as it goes. This command only handles
 * the final cleanup: deleting the job file and committing that deletion.
 */

import { Command } from "commander";
import * as path from "node:path";
import { requireBoxRoot, toRelativePath } from "../../lib/paths.js";
import { finishJob } from "../../core/finish-job.js";
import { errorMessage } from "../../lib/error-guards.js";

export const finishCommand = new Command("finish")
  .description("Complete a job by deleting its card file")
  .argument("<job-file>", "Path to the job card file to finish")
  .action(async (jobFile: string) => {
    const boxRoot = await requireBoxRoot();

    // Resolve the job file path
    const absPath = path.resolve(jobFile);
    const relPath = toRelativePath(boxRoot, absPath);

    if (!relPath) {
      console.error(`Error: ${jobFile} is not inside the box`);
      process.exit(1);
    }

    if (!relPath.endsWith(".job.card")) {
      console.error(`Error: ${relPath} is not a job card (expected *.job.card)`);
      process.exit(1);
    }

    try {
      await finishJob({ boxRoot, jobRelPath: relPath });
      console.log(`Finished job: ${relPath}`);
    } catch (error) {
      console.error(`Error finishing job: ${errorMessage(error)}`);
      process.exit(1);
    }
  });
