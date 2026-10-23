#!/usr/bin/env tsx
/**
 * `root-question-2026-10` runner: repair the seeded root question card
 * (`plan.ts` holds the decision).
 *
 * 1. Read `_bookkeeping/questions/what-to-keep-track-of.question.card`. A box
 *    without it (the question was never seeded, or the card was removed) has
 *    nothing to do. Without `--apply` the runner stops after printing the plan.
 * 2. Apply: write the card with the stock lines replaced.
 * 3. Verify: a fresh plan must find nothing left.
 *
 * A rerun on a repaired box reports "already current".
 *
 * Usage:
 *   pnpm exec tsx src/scripts/migrate/root-question/run.ts <boxRoot>           # plan only
 *   pnpm exec tsx src/scripts/migrate/root-question/run.ts <boxRoot> --apply
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT_QUESTION_PATH } from "../../../core/box/root-question-path.js";
import { errnoCode } from "../../../shared/error-guards.js";
import { planRootQuestion } from "./plan.js";

export type RunMode = "plan" | "apply";

/** One run over one box. Returns the exit code and the lines it printed. */
export async function runRootQuestion({ boxRoot, mode }: { boxRoot: string; mode: RunMode }): Promise<{ code: number; lines: string[] }> {
  const file = path.join(boxRoot, ROOT_QUESTION_PATH);
  let text: string;
  try {
    text = await fs.readFile(file, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return { code: 0, lines: ["root-question: no root question card; nothing to do."] };
    throw e;
  }
  const plan = planRootQuestion({ text });
  if (plan.kind === "current") return { code: 0, lines: ["root-question: already current."] };
  const summary = plan.changes.join("; ");
  if (mode === "plan") return { code: 0, lines: [`would repair ${ROOT_QUESTION_PATH}: ${summary} (dry run; pass --apply)`] };
  await fs.writeFile(file, plan.text);
  if (planRootQuestion({ text: plan.text }).kind !== "current") {
    return { code: 1, lines: ["root-question: verify failed: the card still holds stock lines."] };
  }
  return { code: 0, lines: [`root-question: repaired ${ROOT_QUESTION_PATH}: ${summary}.`] };
}

// CLI entry — only when run directly, not when imported by a test.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const boxRoot = args.find((a) => !a.startsWith("--"));
  if (boxRoot === undefined) {
    console.error("Usage: root-question/run.ts <boxRoot> [--apply]\n\nRepair the seeded root question card.");
    process.exit(1);
  }
  const mode: RunMode = args.includes("--apply") ? "apply" : "plan";
  const { code, lines } = await runRootQuestion({ boxRoot: path.resolve(boxRoot), mode });
  for (const line of lines) (code === 0 ? console.log : console.error)(line);
  process.exit(code);
}
