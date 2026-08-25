/**
 * ls command - List cards with optional frontmatter-field template extraction.
 *
 * Supports glob patterns for file matching and {field} placeholders in format
 * templates, where each placeholder is a dotted path into the card's YAML
 * frontmatter (e.g. '{title} by {author}', '{exif.camera}').
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { glob } from "glob";
import { z } from "zod";
import {
  registerCommand,
  parseCommandArgs,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { isCardFile, boxPath } from "../../lib/paths.js";
import { lookupField, loadCardFrontmatter } from "../frontmatter-field.js";

/**
 * Arguments for the ls command. `paths` is optional here because the command
 * owns its presence check (its own error text); the schema is the type
 * boundary.
 */
const LsArgsSchema = z.object({
  /** Glob patterns or directories to list */
  paths: z.array(z.string()).optional(),
  /** Frontmatter template applied per card (e.g. "{status} {title}") */
  format: z.string().optional(),
});

/**
 * Check if a string contains glob special characters.
 */
function hasGlobChars(s: string): boolean {
  return /[*?[\]{}]/.test(s);
}

/**
 * Expand a single path argument into matching card file paths.
 * If it's a directory, list .card files in it (non-recursive).
 * If it contains glob chars, expand the glob.
 * Otherwise treat as a literal file path.
 */
async function expandPath(
  pattern: string,
  boxRoot: string
): Promise<string[]> {
  const absolute = path.isAbsolute(pattern)
    ? pattern
    : boxPath(boxRoot, pattern);

  if (hasGlobChars(pattern)) {
    const matches = await glob(pattern, { cwd: boxRoot, nodir: true });
    return matches
      .map((m) => (path.isAbsolute(m) ? m : path.join(boxRoot, m)))
      .filter((m) => isCardFile(m))
      .toSorted();
  }

  // Check if it's a directory
  try {
    const stat = await fs.stat(absolute);
    if (stat.isDirectory()) {
      const entries = await fs.readdir(absolute);
      return entries
        .filter((e) => isCardFile(e))
        .toSorted()
        .map((e) => path.join(absolute, e));
    }
  } catch (_e) {
    // fs.stat rejects when the path doesn't exist — that's expected here,
    // it just means "not a directory", and we fall through to treating the
    // argument as a literal file path. No detail in the error to act on.
  }

  // Literal file
  return [absolute];
}

/**
 * Apply a format template to a card's frontmatter, replacing {field}
 * placeholders with the scalar value at that dotted frontmatter path.
 */
function applyTemplate(template: string, frontmatter: Record<string, unknown>): string {
  return template.replace(/{([^}]+)}/g, (_match, expr: string) => lookupField(frontmatter, expr));
}

/**
 * Execute the ls command.
 */
async function executeLs(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const { paths, format } = parseCommandArgs(args, LsArgsSchema);

  if (!paths || paths.length === 0) {
    return { success: false, error: "At least one path or glob pattern is required" };
  }

  // Expand all paths
  const allFiles: string[] = [];
  for (const p of paths) {
    const expanded = await expandPath(p, ctx.boxRoot);
    allFiles.push(...expanded);
  }

  if (allFiles.length === 0) {
    return { success: true, data: { count: 0 } };
  }

  const lines: string[] = [];

  for (const filePath of allFiles) {
    const relativePath = path.relative(ctx.boxRoot, filePath);

    if (!format) {
      ctx.writeLine(relativePath);
      lines.push(relativePath);
      continue;
    }

    // Read frontmatter and apply the template. A card that can't be read or
    // has no frontmatter falls back to showing just the path so `ls` still
    // lists it; warn so a malformed/bodiless card is visible rather than
    // silently rendered template-free.
    const frontmatter = await loadCardFrontmatter(filePath);
    if (frontmatter === null) {
      console.warn(`ls: could not read frontmatter for ${relativePath}`);
      ctx.writeLine(relativePath);
      lines.push(relativePath);
      continue;
    }
    const formatted = applyTemplate(format, frontmatter);
    const line = `${relativePath}\t${formatted}`;
    ctx.writeLine(line);
    lines.push(line);
  }

  return { success: true, data: { count: lines.length, lines } };
}

// Register the command
registerCommand({
  name: "ls",
  description: "List cards with optional frontmatter-field template extraction",
  args: [
    {
      name: "paths",
      description: "Glob patterns or directories to list",
      required: true,
      type: "string[]",
    },
    {
      name: "format",
      description:
        "Template with {field} placeholders (dotted frontmatter paths), e.g. '{title} by {author}'",
      required: false,
      type: "string",
    },
  ],
  execute: executeLs,
});

