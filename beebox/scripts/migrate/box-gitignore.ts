#!/usr/bin/env tsx
/**
 * `gitignore-2026-09` — regenerate the box's `.gitignore` and untrack what it
 * now ignores.
 *
 * The 2026-08 rename moved the state directory to `.beebox/` and the lock and
 * pid files to the `.bbx-` prefix. `bbx init` writes an ignore file that knows
 * the new names, but the state migration that renamed the directory did not
 * touch `.gitignore`, so every existing box kept its pre-rename file, which
 * ignored nothing current. The next `git add -A` autocommit then swept the
 * whole state directory in: chat registry, active-chat locks, the events and
 * usage databases, logs, and the mobile-device secrets. One local box had
 * committed 180 such files before this was noticed
 * (`issues/bugs/2026-09-03-rename-left-old-gitignore-boxes-commit-state-dir.md`).
 *
 * Two steps, both idempotent:
 *   1. Write `.gitignore` from the current rendering (`writeBoxGitignore`, the
 *      same function `bbx init` uses).
 *   2. `git rm --cached` the tracked files the new rules cover, from an explicit
 *      allowlist: the state directory, the box-root locks, and the pid file.
 *      Nothing else, even if ignored-and-tracked — a manifest-scheme box may
 *      track asset bytes its ignore file lists, and untracking those would
 *      turn into a deletion at the next commit.
 *
 * `.beebox/box.json`, the shape marker, is left tracked on purpose: it is
 * tracked on every production box today, and whether it belongs in the state
 * directory at all is the box-layout question, not this migration's.
 *
 * Like every migrator this leaves the working tree uncommitted; `bbx migrate
 * --sweep` commits it as "Apply migration: gitignore-2026-09".
 *
 * Usage (invoked by `bbx migrate`):
 *   pnpm exec tsx scripts/migrate/box-gitignore.ts <boxRoot> --apply
 */
import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import { isAnnexInitialized } from "../../src/core/annex/is-annex-box.js";
import { writeBoxGitignore } from "../../src/core/box/index.js";
import { getBoxShape } from "../../src/lib/box-shape.js";
import { errorMessage } from "../../src/lib/error-guards.js";

const execFileAsync = promisify(execFile);

/** The marker stays tracked; see the header. */
const KEEP_TRACKED = new Set([".beebox/box.json"]);

/** Box-relative paths the regenerated ignore file covers and this migration untracks. */
export function untrackableStatePaths(trackedBoxRelative: readonly string[]): string[] {
  return trackedBoxRelative.filter((rel) => {
    if (KEEP_TRACKED.has(rel)) return false;
    if (rel.startsWith(".beebox/")) return true;
    if (rel === ".bbx-lock" || rel === ".bbx-serve.pid") return true;
    return /^\.bbx-[a-z-]+\.lock$/.test(rel);
  });
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

async function main(): Promise<number> {
  const target = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (target === undefined || target === "") {
    process.stderr.write("usage: box-gitignore <boxRoot> [--apply]\n");
    return 1;
  }
  const boxRoot = path.resolve(target);
  const shape = await getBoxShape(boxRoot);
  const contentPrefix = path.relative(shape.packageRoot, boxRoot).split(path.sep).join("/");
  const listed = await git(shape.packageRoot, ["ls-files", "-z", "--", contentPrefix]);
  const tracked = listed.split("\0").filter((p) => p !== "").map((p) => p.slice(contentPrefix.length + 1));
  const toUntrack = untrackableStatePaths(tracked);

  if (!apply) {
    process.stdout.write(`[box-gitignore] would rewrite .gitignore and untrack ${String(toUntrack.length)} file(s).\n`);
    for (const rel of toUntrack) process.stdout.write(`  ${rel}\n`);
    return 0;
  }

  const annexed = await isAnnexInitialized(shape.packageRoot);
  await writeBoxGitignore(boxRoot, { annexed });
  if (toUntrack.length > 0) {
    const repoPaths = toUntrack.map((rel) => `${contentPrefix}/${rel}`);
    await git(shape.packageRoot, ["rm", "-r", "--cached", "--quiet", "--", ...repoPaths]);
  }
  process.stdout.write(
    toUntrack.length === 0
      ? "[box-gitignore] .gitignore rewritten; nothing was tracked that it now ignores.\n"
      : `[box-gitignore] .gitignore rewritten; untracked ${String(toUntrack.length)} state file(s) (still on disk).\n`,
  );
  return 0;
}

// A doctest imports `untrackableStatePaths`; only a direct run migrates.
if (process.argv[1] !== undefined && path.basename(process.argv[1]).startsWith("box-gitignore")) {
  try {
    process.exit(await main());
  } catch (e) {
    process.stderr.write(`[box-gitignore] failed: ${errorMessage(e)}\n`);
    process.exit(1);
  }
}
