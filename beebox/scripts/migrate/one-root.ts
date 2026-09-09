#!/usr/bin/env tsx

/**
 * `one-root` — v2 → v3 one-root layout migration (Track E,
 * `docs/implemented-plans/one-root-box-layout.md`). Unlike every other entry in
 * `MIGRATIONS`, this script runs against a box that ISN'T v3 yet — that's the
 * whole point (see the plan's "Bootstrap" paragraph). `bbx migrate`'s
 * bootstrap path (`src/cli/commands/migrate.ts`) invokes this directly,
 * passing the v2 PACKAGE root — never through the normal
 * `getBoxShape`-gated flow the other migrators use.
 *
 * Usage:
 *   pnpm exec tsx scripts/migrate/one-root.ts <v2PackageRoot> --apply
 *
 * All the real logic lives in `src/core/migrations/one-root-run.ts` so it's
 * importable directly (no subprocess) from doctests.
 */

import * as path from "node:path";
import { probeV2Box } from "../../src/core/migrations/one-root-v2-probe.js";
import { runOneRootMigration } from "../../src/core/migrations/one-root-run.js";
import { errorMessage } from "../../src/lib/error-guards.js";

async function main(): Promise<number> {
  const target = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (target === undefined || target === "") {
    process.stderr.write("usage: one-root <v2PackageRoot> [--apply]\n");
    return 1;
  }

  const packageRoot = path.resolve(target);
  const v2Box = await probeV2Box(packageRoot);
  if (v2Box === null) {
    process.stderr.write(
      `[one-root] ${packageRoot} is not a v2 box (no v2 marker there or at content/). Nothing to migrate.\n`,
    );
    return 1;
  }

  if (!apply) {
    process.stdout.write(
      `[one-root] ${v2Box.packageRoot} is a v2 box (shapeVersion ${String(v2Box.shapeVersion)}); ` +
        `would migrate ${v2Box.contentRoot} into the one-root layout. Re-run with --apply.\n`,
    );
    return 0;
  }

  const result = await runOneRootMigration({ packageRoot: v2Box.packageRoot, contentRoot: v2Box.contentRoot });
  process.stdout.write(
    `[one-root] migrated ${String(result.filesMoved)} file(s); commit ${result.commitSha}.\n`,
  );
  if (result.preExistingBrokenRefsCarried > 0) {
    process.stdout.write(
      `[one-root] ${String(result.preExistingBrokenRefsCarried)} pre-existing broken reference(s) carried ` +
        "through (already dangling before this migration touched anything — not a new break, so the hard link " +
        "gate did not block on them).\n",
    );
  }
  if (result.unresolvedRefs.length > 0) {
    process.stdout.write(
      `[one-root] ${String(result.unresolvedRefs.length)} ref(s) could not be resolved to a v3 target ` +
        "(left as written — this would have failed the hard link gate if they were truly dangling):\n" +
        result.unresolvedRefs.map((r) => `  ${r}`).join("\n") +
        "\n",
    );
  }
  if (result.skippedSymlinkRefs.length > 0) {
    process.stdout.write(
      `[one-root] ${String(result.skippedSymlinkRefs.length)} migrated card/doc path(s) are symlinks and were ` +
        "left byte-untouched (their ref content belongs to their target, not the link — an in-box target was " +
        "already rewritten when its own entry was inventoried; a target outside the box may now carry stale " +
        "refs):\n" +
        result.skippedSymlinkRefs.map((r) => `  ${r}`).join("\n") +
        "\n",
    );
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    process.stderr.write(`[one-root] failed: ${errorMessage(e)}\n`);
    process.exit(1);
  });
