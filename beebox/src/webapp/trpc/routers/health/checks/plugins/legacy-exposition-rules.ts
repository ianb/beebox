/**
 * `legacy-exposition-rules` (warning): an `*.exposition-plan.card` whose
 * frontmatter `rules` is a non-empty array. The rules now live in the course
 * directory's AGENTS.md (courseware README, Migration); the field stays on
 * the schema so old cards validate, and this check names each card still
 * carrying one until the move is done.
 *
 * Core owns it rather than the courseware plugin because it must fire when
 * the plugin is inactive: that is the box the migration is for.
 */

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { parseFrontmatterObject } from "../../../../../../cards/frontmatter.js";
import { listBoxCardFiles } from "../../../../../../core/list-cards.js";
import type { HealthCheck } from "../../router.js";

const EXPOSITION_PLAN_SUFFIX = ".exposition-plan.card";

export async function legacyExpositionRulesChecks(boxRoot: string): Promise<HealthCheck[]> {
  const files = (await listBoxCardFiles(boxRoot)).filter((f) => f.endsWith(EXPOSITION_PLAN_SUFFIX)).toSorted();
  const checks: HealthCheck[] = [];
  for (const abs of files) {
    if (!(await hasLegacyRules(abs))) continue;
    const rel = path.relative(boxRoot, abs).split(path.sep).join("/");
    checks.push({
      name: "legacy-exposition-rules",
      ok: false,
      message: `${rel}: \`rules\` is legacy; move them into the course directory's AGENTS.md (courseware README, Migration).`,
      severity: "warning",
    });
  }
  if (checks.length === 0) {
    checks.push({
      name: "legacy-exposition-rules",
      ok: true,
      message: "No exposition-plan card carries a legacy `rules` field",
      severity: "warning",
    });
  }
  return checks;
}

/** Unreadable or malformed frontmatter reads as no rules: validation reports that card. */
async function hasLegacyRules(abs: string): Promise<boolean> {
  const frontmatter = parseFrontmatterObject(await readFile(abs, "utf8"));
  const rules = frontmatter?.["rules"];
  return Array.isArray(rules) && rules.length > 0;
}
