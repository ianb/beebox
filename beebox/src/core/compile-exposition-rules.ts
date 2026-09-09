/**
 * Compile each exposition-plan card's `rules` into a committed, path-loaded box
 * rule at `.claude/rules/exposition-<course>.md`, so the rules auto-load while
 * the agent works in that course (reading material, updating progress).
 *
 * Mirrors `compileGuides`: a derived artifact, clean-and-rewritten, never
 * hand-edited — the source of truth is the card's `rules` field. It runs both in
 * `generateDocs` (bulk: every session/reactor/init) and from the `bbx validate`
 * PostToolUse hook when an exposition-plan card is edited (immediate refresh).
 */

import { mkdir, writeFile, readdir, unlink, readFile } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import { splitCardContent } from "../cards/index.js";
import { parse as parseYaml } from "yaml";
import { listBoxCardFiles } from "./list-cards.js";
import { getBoxShape } from "../lib/box-shape.js";
import { errnoCode } from "../lib/error-guards.js";
import { isRecord } from "./card-io.js";

const RULE_PREFIX = "exposition-";

/** Read the `rules` string array from an exposition-plan card, defensively. */
async function readRules(absPath: string): Promise<string[]> {
  let content: string;
  try {
    content = await readFile(absPath, "utf8");
  } catch (_e) {
    return [];
  }
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) return [];
  let fm: unknown;
  try {
    fm = parseYaml(split.frontmatterText);
  } catch (_e) {
    return [];
  }
  if (!isRecord(fm)) return [];
  const rules = fm["rules"];
  if (!Array.isArray(rules)) return [];
  return rules.filter((r): r is string => typeof r === "string");
}

/** Slug a course-dir relative path into a stable rule-filename segment. */
function slugFor(courseDir: string): string {
  return courseDir
    .replace(/[^\dA-Za-z]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function renderRule(input: { courseDir: string; rules: string[] }): string {
  return [
    "---",
    "paths:",
    `  - "${input.courseDir}/**"`,
    "---",
    `# Exposition rules — ${input.courseDir}`,
    "",
    "GENERATED from the course's exposition-plan card — edit that card's `rules`, not this file.",
    "",
    "When presenting this course's material, follow these rules:",
    "",
    ...input.rules.map((r) => `- ${r}`),
    "",
  ].join("\n");
}

/**
 * Clean-and-rewrite the `exposition-*.md` rules in `.claude/rules/` from every
 * exposition-plan card in the box. Returns the filenames written.
 *
 * `.claude/rules` lives at the box root (shapeVersion 3: the one root), the
 * same root course directories live under, so the generated `paths:` glob is
 * just the course directory relative to `boxRoot` — no cross-root prefix.
 */
export async function compileExpositionRules(boxRoot: string): Promise<string[]> {
  const shape = await getBoxShape(boxRoot);
  const rulesDir = join(shape.boxRoot, ".claude", "rules");
  await mkdir(rulesDir, { recursive: true });

  // Remove stale exposition-*.md so a renamed/deleted course leaves no orphan.
  try {
    for (const file of await readdir(rulesDir)) {
      if (file.startsWith(RULE_PREFIX) && file.endsWith(".md")) {
        await unlink(join(rulesDir, file));
      }
    }
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.debug("exposition-rules cleanup skipped (rules dir not readable):", e);
    }
  }

  const cards = (await listBoxCardFiles(boxRoot)).filter((p) => p.endsWith(".exposition-plan.card"));
  const written: string[] = [];
  for (const abs of cards) {
    const rules = await readRules(abs);
    if (rules.length === 0) continue;
    const courseDir = relative(boxRoot, dirname(abs));
    const filename = `${RULE_PREFIX}${slugFor(courseDir)}.md`;
    await writeFile(join(rulesDir, filename), renderRule({ courseDir, rules }));
    written.push(filename);
  }
  return written;
}
