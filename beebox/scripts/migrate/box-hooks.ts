#!/usr/bin/env tsx
/**
 * `hooks-2026-09` — reinstall the box's managed git hooks and Claude settings.
 *
 * The hooks `bbx init` installs (`src/core/install-validation-hooks.ts`) bake
 * in the CLI binary's path and name. The 2026-08 rename changed both, and the
 * state migration that moved the box's state directory never reinstalled
 * them, so every existing box kept hooks that look for the former CLI at a
 * checkout that no longer exists and print "not found ... skipping card
 * validation" on every commit. Same defect class as `gitignore-2026-09`: init
 * knows the current rendering, existing boxes were never re-run through it.
 *
 * `installValidationHooks` is idempotent and rewrites only hooks it manages
 * (it recognises the pre-rename marker); a foreign hook is left alone with a
 * warning, and a box that is not a git repository gets only the settings
 * file. The hook files live under `.git/`, so nothing here lands in the
 * working tree except a possible `.claude/settings.json` change at the
 * package root.
 *
 * Usage (invoked by `bbx migrate`):
 *   pnpm exec tsx scripts/migrate/box-hooks.ts <boxRoot> --apply
 */
import * as path from "node:path";
import { installValidationHooks } from "../../src/core/install-validation-hooks.js";
import { errorMessage } from "../../src/lib/error-guards.js";

async function main(): Promise<number> {
  const target = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (target === undefined || target === "") {
    process.stderr.write("usage: box-hooks <boxRoot> [--apply]\n");
    return 1;
  }
  if (!apply) {
    process.stdout.write("[box-hooks] would reinstall the managed git hooks and Claude settings.\n");
    return 0;
  }
  const changed = await installValidationHooks(path.resolve(target));
  process.stdout.write(
    changed.length === 0
      ? "[box-hooks] hooks already current; nothing to do.\n"
      : `[box-hooks] reinstalled: ${changed.join(", ")}\n`,
  );
  return 0;
}

try {
  process.exit(await main());
} catch (e) {
  process.stderr.write(`[box-hooks] failed: ${errorMessage(e)}\n`);
  process.exit(1);
}
