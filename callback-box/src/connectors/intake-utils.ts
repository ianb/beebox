/**
 * Utilities for creating and appending to intake job cards.
 *
 * Connectors call createOrAppendIntakeJob() after creating inbox items.
 * If a pending intake job from the same source already exists, items
 * are appended to it rather than creating a new job.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseXml, escapeAttr } from "cardworks";
import { createIntakeJobTemplate } from "../schemas/intake-job.js";
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
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const root = await parseXml(content, entry);
      if (
        root.attrs.status === "pending" &&
        root.attrs.source === source
      ) {
        return { path: filePath };
      }
    } catch {
      // Skip unparseable files
      continue;
    }
  }
  return null;
}

/**
 * Append items to an existing intake job card and update its description.
 */
async function appendToIntakeJob(
  jobPath: string,
  opts: { items: string[]; description: string }
): Promise<void> {
  const content = await fs.readFile(jobPath, "utf-8");

  // Build new item elements
  const newItemElements = opts.items
    .map((ref) => `  <item ref="${escapeAttr(ref)}" />`)
    .join("\n");

  // Insert new items before the closing tag
  const updated = content.replace(
    /<\/intake-job>/,
    `${newItemElements}\n</intake-job>`
  );

  // Update description to reflect new count
  const descUpdated = updated.replace(
    /<description>.*?<\/description>/,
    `<description>${opts.description}</description>`
  );

  await fs.writeFile(jobPath, descUpdated);
}
