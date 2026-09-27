#!/usr/bin/env tsx
/**
 * Lint the agent guide (`src/core/agent-guide/guide.md`) against its ledger;
 * the checks are in `src/core/agent-guide/lint.ts`, the spec in
 * docs/agent-guide.md.
 *
 * Usage:
 *   pnpm lint:guide                 # a fresh bare box, budget asserted
 *   pnpm lint:guide --box <path>    # an existing box, read-only, budget asserted
 *   pnpm lint:guide --report        # also print word counts
 *
 * Prints nothing and exits 0 when the guide passes; prints each failure and
 * exits 1 otherwise.
 */

import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { scaffoldBoxRoot } from "../core/box/package.js";
import { generateDocs } from "../core/docs-gen/index.js";
import { lintBoxGuide, type BoxGuideLintReport } from "./lib/guide-lint-box.js";

/** A bare box as `bbx init` leaves it: scaffolded, git-initialized, docs generated. */
async function withBareBox(fn: (boxRoot: string) => Promise<BoxGuideLintReport>): Promise<BoxGuideLintReport> {
  const boxRoot = await mkdtemp(join(tmpdir(), "bbx-lint-guide-"));
  try {
    await scaffoldBoxRoot(boxRoot);
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: boxRoot });
    await generateDocs(boxRoot, { force: true, commit: false });
    return await fn(boxRoot);
  } finally {
    await rm(boxRoot, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
const boxIndex = args.indexOf("--box");
const boxArg = boxIndex === -1 ? undefined : args[boxIndex + 1];
if (boxIndex !== -1 && boxArg === undefined) {
  console.error("Usage: pnpm lint:guide [--box <path>] [--report]");
  process.exit(1);
}

const report = boxArg === undefined ?
  await withBareBox((boxRoot) => lintBoxGuide(boxRoot, { checkBudget: true })) :
  await lintBoxGuide(resolve(boxArg), { checkBudget: true });

if (args.includes("--report")) {
  console.log(`guide: ${String(report.guideWords)} words; always-loaded: ${String(report.alwaysLoadedWords)} words`);
  for (const [section, count] of Object.entries(report.uncitedWords)) console.log(`  ${section}: ${String(count)} uncited`);
}
for (const failure of report.failures) console.error(`lint:guide: ${failure}`);
if (report.failures.length > 0) process.exit(1);
