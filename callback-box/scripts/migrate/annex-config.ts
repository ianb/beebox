#!/usr/bin/env tsx

/**
 * `annex-config-2026-08` — re-apply the box's git-annex configuration.
 *
 * `annex.largefiles` and `.git/info/attributes` are rendered from
 * `src/lib/asset-extensions.ts` and written into a box ONCE, at conversion or
 * `cb init`. When either rendering changes, every existing box keeps the old
 * one: `cb doctor annex --check` reports it, but nothing runs that, and
 * `cb health` forwards only the `binary` and `content-present` checks. Three of
 * four production boxes were stale for two weeks this way.
 *
 * This migration is that convergence step, expressed as a thing the box
 * records having done. It runs the same repair pass as `cb doctor annex` — the
 * repairs are idempotent, so a box already current reports "ok" for every check
 * and changes nothing.
 *
 * **A new rendering needs a NEW migration entry**, dated like this one. The
 * manifest key is what makes a migration run once, so re-running this name
 * after the next change is not possible by design — see
 * `issues/bugs/2026-08-18-stale-annex-largefiles-never-reapplies.md` for the
 * standing question of what should re-apply box configuration on its own.
 *
 * Nothing here touches tracked files: `.git/info/attributes` is untracked and
 * `annex.largefiles` lives on the git-annex branch, so this migration leaves
 * the working tree exactly as it found it.
 *
 * Usage (invoked by `cb migrate`):
 *   pnpm exec tsx scripts/migrate/annex-config.ts <boxRoot> --apply
 */

import * as path from "node:path";
import { runAnnexDoctor } from "../../src/core/annex/doctor.js";
import { createGitAnnexService } from "../../src/services/git-annex.js";
import { getBoxShape } from "../../src/lib/box-shape.js";
import { errorMessage } from "../../src/lib/error-guards.js";

async function main(): Promise<number> {
  const target = process.argv[2];
  if (target === undefined || target === "") {
    process.stderr.write("usage: annex-config <boxRoot> [--apply]\n");
    return 1;
  }
  const boxRoot = path.resolve(target);
  const shape = await getBoxShape(boxRoot);
  const result = await runAnnexDoctor(createGitAnnexService(), {
    repoRoot: shape.packageRoot,
    boxRoot,
  });

  for (const check of result.checks) {
    if (check.status === "repaired") process.stdout.write(`[annex-config] repaired ${check.id}: ${check.message}\n`);
  }

  // A check the box could not put right is not something to record as done.
  // Exiting non-zero halts `cb migrate` with the manifest entry unwritten, so
  // the box retries after the underlying problem is fixed — the alternative is
  // a box that believes it converged and silently never will.
  const failed = result.checks.filter((c) => c.status === "failed");
  if (failed.length > 0) {
    for (const check of failed) process.stderr.write(`[annex-config] ${check.id}: ${check.message}\n`);
    return 1;
  }

  const repaired = result.checks.filter((c) => c.status === "repaired").length;
  process.stdout.write(
    repaired === 0
      ? "[annex-config] annex configuration already current; nothing to do.\n"
      : `[annex-config] repaired ${String(repaired)} setting(s).\n`,
  );
  return 0;
}

try {
  process.exit(await main());
} catch (e) {
  process.stderr.write(`[annex-config] failed: ${errorMessage(e)}\n`);
  process.exit(1);
}
