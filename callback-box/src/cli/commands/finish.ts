/**
 * cb finish <job-file> - Complete a job by deleting its card file.
 *
 * The agent commits its own work as it goes. This command only handles
 * the final cleanup: deleting the job file and committing that deletion.
 */

import { Command } from "commander";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { requireBoxRoot, parseCardName, toRelativePath } from "../lib/paths.js";
import { stageFiles, commit } from "../lib/git.js";

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

    // Read the job card for context before deleting
    let description = "";
    let jobType = "";
    try {
      const content = await fs.readFile(absPath, "utf-8");
      // Extract description from XML
      const descMatch = content.match(/<description>(.*?)<\/description>/s);
      if (descMatch) {
        description = descMatch[1]!.trim();
      }
      // Extract job type from filename (e.g., "news" from "foo.news.job.card")
      const parsed = parseCardName(path.basename(relPath));
      if (parsed) {
        // parsed.type would be "job" for "*.job.card", but we want the sub-type
        // e.g., "foo.news.job.card" -> we need to parse differently
        const parts = path.basename(relPath).split(".");
        // parts: ["foo", "news", "job", "card"]
        if (parts.length >= 4) {
          jobType = parts[parts.length - 3]!; // "news"
        }
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
        console.log(`Job file already deleted: ${relPath}`);
        return;
      }
      throw err;
    }

    // Stage and commit just the deletion
    await stageFiles(boxRoot, [relPath]);

    const commitMsg = description
      ? `Finish job: ${description}`
      : `Finish ${jobType || "unknown"} job`;

    const trailers: Record<string, string> = {};
    if (jobType) {
      trailers["Job-Type"] = jobType;
    }

    await commit(boxRoot, { message: commitMsg, trailers });

    console.log(`Finished job: ${relPath}`);
  });
