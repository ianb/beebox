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
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { splitCardContent } from "cardworks";
import { createIntakeJobTemplate, type IntakeJobFields } from "../schemas/intake-job.js";
import { getBoxTimeISO } from "../cli/lib/time.js";

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
  const timestamp = getBoxTimeISO(opts.boxRoot)
    .replace(/[.:]/g, "-")
    .slice(0, 19);
  const safeSource = opts.source.replace(/[^\dA-Za-z-]/g, "-");
  const jobFilename = `${timestamp}-${safeSource}.intake.job.card`;
  const jobPath = path.join(jobsDir, jobFilename);

  const templateOpts: Parameters<typeof createIntakeJobTemplate>[0] = {
    created: getBoxTimeISO(opts.boxRoot),
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
 * Create a new intake job (never appends to existing).
 * Used for batched job creation where each batch needs its own job file.
 */
export async function createNewIntakeJob(
  opts: IntakeJobOptions
): Promise<string> {
  const jobsDir = path.join(opts.boxRoot, "box/jobs");
  await fs.mkdir(jobsDir, { recursive: true });

  const timestamp = getBoxTimeISO(opts.boxRoot)
    .replace(/[.:]/g, "-")
    .slice(0, 19);
  const safeSource = opts.source.replace(/[^\dA-Za-z-]/g, "-");
  const suffix = String(Math.random()).slice(2, 6);
  const jobFilename = `${timestamp}-${safeSource}-${suffix}.intake.job.card`;
  const jobPath = path.join(jobsDir, jobFilename);

  const templateOpts: Parameters<typeof createIntakeJobTemplate>[0] = {
    created: getBoxTimeISO(opts.boxRoot),
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
 * Find an existing pending intake job card with a matching source.
 */
async function findExistingIntakeJob(
  jobsDir: string,
  source: string
): Promise<{ path: string } | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(jobsDir);
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".intake.job.card")) continue;
    const filePath = path.join(jobsDir, entry);
    const fields = await readIntakeJobFields(filePath);
    if (fields === null) continue;
    if (fields.status === "pending" && fields.source === source) {
      return { path: filePath };
    }
  }
  return null;
}

async function readIntakeJobFields(filePath: string): Promise<IntakeJobFields | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const split = splitCardContent(content);
    if (!split.hasFrontmatter) return null;
    const parsed = parseYaml(split.frontmatterText) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as IntakeJobFields;
  } catch {
    return null;
  }
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
    throw new Error(`appendToIntakeJob: failed to read ${jobPath}`);
  }
  fields.description = opts.description;
  fields.items = [...fields.items, ...opts.items.map((ref) => ({ ref }))];
  await fs.writeFile(jobPath, `---\n${stringifyYaml(fields)}---\n`);
}
