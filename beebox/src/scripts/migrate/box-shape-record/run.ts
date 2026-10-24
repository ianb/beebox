#!/usr/bin/env tsx
/**
 * `box-shape-record-2026-10` runner: record the box's shape in its tracked
 * `package.json` (`plan.ts` holds the decision).
 *
 * 1. Plan: read `package.json` and `.beebox/box.json`. A refusal prints the
 *    reason and exits 1 with nothing written, so `bbx engine migrate` records
 *    nothing and later migrations wait. Without `--apply` the runner stops
 *    after printing the plan.
 * 2. Apply: write the `beebox` block.
 * 3. Leave the marker alone (boxholder decision, 2026-10-20): an older engine
 *    still reads it, so a deploy rollback keeps opening the box. Where the
 *    marker is still tracked (production boxes), it also stays tracked here:
 *    the sweep commits the paths whose working-tree content changed
 *    (`changedMigrationPaths`), so an untrack that keeps the file on disk
 *    would be left staged and swept into the next unrelated commit.
 *    `issues/deferred/2026-10-20-drop-box-marker-fallback.md` deletes the
 *    file, which the sweep does commit, untracking it in the same commit.
 * 4. Verify: `readShapeRecord` must now come from the block.
 *
 * A rerun on a converted box reports "already converted".
 *
 * Usage:
 *   pnpm exec tsx src/scripts/migrate/box-shape-record/run.ts <boxRoot>           # plan only
 *   pnpm exec tsx src/scripts/migrate/box-shape-record/run.ts <boxRoot> --apply
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { BOX_MARKER, readShapeRecord } from "../../../lib/box-identity.js";
import { errnoCode } from "../../../shared/error-guards.js";
import { planShapeRecord } from "./plan.js";

export type RunMode = "plan" | "apply";

async function readOptional(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
}

/** One run over one box. Returns the exit code and the lines it printed. */
export async function runBoxShapeRecord({ boxRoot, mode }: { boxRoot: string; mode: RunMode }): Promise<{ code: number; lines: string[] }> {
  const packageJsonPath = path.join(boxRoot, "package.json");
  const packageJson = await readOptional(packageJsonPath);
  if (packageJson === null) return { code: 1, lines: [`box-shape-record: ${packageJsonPath} is missing; nothing written.`] };
  const plan = planShapeRecord({ packageJson, marker: await readOptional(path.join(boxRoot, BOX_MARKER)) });
  if (plan.kind === "refuse") return { code: 1, lines: [`box-shape-record: ${plan.reason} Nothing written.`] };
  if (plan.kind === "already-converted") return { code: 0, lines: ["box-shape-record: already converted."] };
  if (mode === "plan") {
    return { code: 0, lines: [`would add "beebox": { "shapeVersion": 3, "created": "${plan.created}" } to package.json (dry run; pass --apply)`] };
  }
  await fs.writeFile(packageJsonPath, plan.packageJson);
  const record = await readShapeRecord(boxRoot);
  if (record.source !== "package") {
    return { code: 1, lines: ["box-shape-record: verify failed: the shape is still read from the marker."] };
  }
  return { code: 0, lines: [`box-shape-record: added "beebox": { "shapeVersion": 3, "created": "${plan.created}" } to package.json.`] };
}

// CLI entry — only when run directly, not when imported by a test.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const boxRoot = args.find((a) => !a.startsWith("--"));
  if (boxRoot === undefined) {
    console.error("Usage: box-shape-record/run.ts <boxRoot> [--apply]\n\nRecord the box's shape in its package.json.");
    process.exit(1);
  }
  const mode: RunMode = args.includes("--apply") ? "apply" : "plan";
  const { code, lines } = await runBoxShapeRecord({ boxRoot: path.resolve(boxRoot), mode });
  for (const line of lines) (code === 0 ? console.log : console.error)(line);
  process.exit(code);
}
