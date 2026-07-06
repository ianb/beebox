/**
 * Utilities for creating and appending to intake job cards.
 *
 * Connectors call createOrAppendIntakeJob() after creating inbox items.
 * If a pending intake job from the same source already exists, items
 * are appended to it rather than creating a new job.
 *
 * The `source` value here doubles as the reactor's source filter key —
 * use the connector's canonical name (e.g. "gmail", "telegram"), not a
 * decorated form like "gmail-connector", or `cb wakeup --connector X`
 * won't pick up the job it just created.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseFrontmatterObject, renderFrontmatterBlock } from "../cards/index.js";
import { createIntakeJobTemplate, type IntakeJobFields } from "../schemas/intake-job.js";
import { findPendingJobCard, timestampedJobFilename } from "./job-cards.js";

class IntakeJobReadError extends Error {
  constructor(jobPath: string) {
    super(`appendToIntakeJob: failed to read ${jobPath}`);
    this.name = "IntakeJobReadError";
  }
}

export interface IntakeJobOptions {
  boxRoot: string;
  source: string;
  items: string[];
  priority?: "normal" | "low";
  description: string;
}

/**
 * Create a new intake job or append items to an existing pending one
 * from the same source. Returns the relative path to the job card.
 */
export async function createOrAppendIntakeJob(
  opts: IntakeJobOptions
): Promise<string> {
  const jobsDir = path.join(opts.boxRoot, "box/jobs");
  await fs.mkdir(jobsDir, { recursive: true });

  // Look for an existing pending intake job from the same source
  const existing = await findExistingIntakeJob(jobsDir, opts.source);

  if (existing) {
    await appendToIntakeJob(existing.path, {
      items: opts.items,
      description: opts.description,
    });
    return path.relative(opts.boxRoot, existing.path);
  }

  // Create a new job card
  const safeSource = opts.source.replace(/[^\dA-Za-z-]/g, "-");
  const jobFilename = timestampedJobFilename(opts.boxRoot, {
    stem: safeSource,
    extension: "intake.job.card",
  });
  const jobPath = path.join(jobsDir, jobFilename);

  const templateOpts: Parameters<typeof createIntakeJobTemplate>[0] = {
    source: opts.source,
    description: opts.description,
    items: opts.items,
  };
  if (opts.priority) templateOpts.priority = opts.priority;
  const content = createIntakeJobTemplate(templateOpts);
  await fs.writeFile(jobPath, content);
  return path.relative(opts.boxRoot, jobPath);
}

/**
 * Find an existing pending intake job card with a matching source. Returns the
 * absolute path wrapped in an object, or null when none exists.
 */
async function findExistingIntakeJob(
  jobsDir: string,
  source: string
): Promise<{ path: string } | null> {
  const found = await findPendingJobCard({
    jobsDir,
    suffix: ".intake.job.card",
    match: (fields) => fields["status"] === "pending" && fields["source"] === source,
  });
  return found === null ? null : { path: found };
}

async function readIntakeJobFields(filePath: string): Promise<IntakeJobFields | null> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`readIntakeJobFields: could not read ${filePath}, skipping:`, e);
    }
    return null;
  }
  // Parse boundary: the loose frontmatter read yields a plain mapping, which we
  // vouch for as IntakeJobFields (validated on load elsewhere; this is a
  // best-effort append path).
  return parseFrontmatterObject(content) as IntakeJobFields | null;
}

/**
 * Append items to an existing intake job card and update its description.
 */
async function appendToIntakeJob(
  jobPath: string,
  opts: { items: string[]; description: string }
): Promise<void> {
  const fields = await readIntakeJobFields(jobPath);
  if (fields === null) {
    throw new IntakeJobReadError(jobPath);
  }
  fields.description = opts.description;
  fields.items = [...fields.items, ...opts.items.map((ref) => ({ ref }))];
  await fs.writeFile(jobPath, renderFrontmatterBlock(fields));
}
