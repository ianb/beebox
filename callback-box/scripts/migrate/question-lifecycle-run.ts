#!/usr/bin/env tsx

/**
 * CLI driver for the question-lifecycle migration (Track A,
 * `docs/plans/questions-end-to-end.md`). The pure per-card transform lives in
 * `question-lifecycle.ts`; this file does the tree walk, resolves git dates
 * and destination names, writes the results, and reports.
 *
 * Four independent fixes over every `*.question.card` in the box:
 *
 *   1. Strip `answered-by:` — the field is removed from the schema (nothing
 *      ever read it; the promise in the old schema instructions was false).
 *   2. Backfill `asked-at:` on `pending` cards that lack it, from the card
 *      file's earliest `git add` date (falls back to "now" if the file has
 *      no git history yet, e.g. an uncommitted card in a scratch clone).
 *   3. Relocate question cards that live outside `box/questions/` (scan-import
 *      writes them inside a capture session's `.attach/` scope, where
 *      `getSystemState` never finds them) into `box/questions/`, giving each
 *      a collision-safe name and — when its directive/prompt/memo actually
 *      references a sibling file in the old scope — a `context:` ref back to
 *      that scope (the capture-session card if one exists alongside the
 *      attach dir, else the attach dir itself) so the relocated card doesn't
 *      lose its provenance.
 *   4. Rewrite directives that instruct edits to the briefing's retired
 *      `<agent-needs-to-know>` element (pre-Markdoc vocabulary) to reference
 *      the current `{% correction %}` block instead.
 *
 * A second pass (`question-lifecycle-refs.ts`) then walks every OTHER card
 * in the box and rewrites any `ref`/`refs` pointing at a relocated
 * question's old path — e.g. an intake-job card whose `items[]` listed the
 * question cards a scan-import batch created.
 *
 * Also reports (never silently fixes) any `select`-type question with fewer
 * than two options — the new `superRefine` on `input` rejects such a card at
 * load, so an unresolved violation needs a human decision, not a migrator
 * guess.
 *
 * Idempotent: a card with none of the above already applies is left as-is.
 * Re-running after a partial apply resumes cleanly — a relocated card is
 * found at its new path on the next walk and simply reports "already".
 *
 * Registered in src/core/migrations.ts. Also runnable directly:
 *   pnpm exec tsx scripts/migrate/question-lifecycle-run.ts <boxRoot>           # dry-run
 *   pnpm exec tsx scripts/migrate/question-lifecycle-run.ts <boxRoot> --apply
 */

import { readFile, writeFile, readdir, access, unlink, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname, basename, relative, resolve, posix } from "node:path";
import { getBoxTimeISO } from "../../src/lib/time.js";
import { migrateQuestionCard, QUESTIONS_DIR } from "./question-lifecycle.js";
import { repairExternalRefs } from "./question-lifecycle-refs.js";

const execFileAsync = promisify(execFile);

/** To posix-style forward slashes, for stable comparisons/refs on disk. */
function toPosix(relPath: string): string {
  return relPath.split("\\").join("/");
}

/** Names skipped during the tree walk. */
const SKIP_DIRS = new Set([".git", "node_modules"]);

async function findQuestionCards(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") return;
      throw e;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".question.card")) {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out;
}

/** Earliest `git add` date for a box-relative path, or null (no history / not a repo). */
async function gitAddDate(boxRoot: string, relPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", "--follow", "--diff-filter=A", "--format=%aI", "--", relPath],
      { cwd: boxRoot }
    );
    const lines = stdout.trim().split("\n").filter((l) => l.length > 0);
    return lines.length > 0 ? (lines[lines.length - 1] ?? null) : null;
  } catch (_e) {
    return null;
  }
}

/** Collision-safe destination filename for a stray question card. */
function destName(originalAbsPath: string, taken: Set<string>): string {
  const parentDirName = basename(dirname(originalAbsPath)).replace(/\.attach$/, "");
  const base = `${parentDirName}_${basename(originalAbsPath)}`;
  if (!taken.has(base)) return base;
  let n = 2;
  const stem = base.slice(0, -".question.card".length);
  let candidate = `${stem}-${String(n)}.question.card`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${stem}-${String(n)}.question.card`;
  }
  return candidate;
}

/** The card's original scope: a sibling capture-session card if one exists, else the attach dir itself (both box-relative, posix). */
async function resolveScopeRef(boxRoot: string, originalAbsPath: string): Promise<string> {
  const attachDirAbs = dirname(originalAbsPath);
  const sessionSlug = basename(attachDirAbs).replace(/\.attach$/, "");
  const captureSessionAbs = join(dirname(attachDirAbs), `${sessionSlug}.capture-session.card`);
  try {
    await access(captureSessionAbs);
    return toPosix(relative(boxRoot, captureSessionAbs));
  } catch (_e) {
    return toPosix(relative(boxRoot, attachDirAbs));
  }
}

async function rmIfExists(absPath: string): Promise<void> {
  try {
    await unlink(absPath);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") throw e;
  }
}

interface RunTotals {
  relocated: number;
  strippedAnsweredBy: number;
  backfilledAskedAt: number;
  fixedDirectiveTag: number;
  addedContext: number;
  already: number;
  skipped: number;
  violations: string[];
  /** Old box-relative path → new box-relative path, for every relocated question card. */
  renameMap: Map<string, string>;
}

async function processOne(
  absPath: string,
  { boxRoot, apply, existingDestNames, fallbackAskedAt, totals }: {
    boxRoot: string;
    apply: boolean;
    existingDestNames: Set<string>;
    fallbackAskedAt: string;
    totals: RunTotals;
  }
): Promise<void> {
  const relPath = toPosix(relative(boxRoot, absPath));
  const raw = await readFile(absPath, "utf8");
  const isCanonical = dirname(relPath) === QUESTIONS_DIR;
  const destRelPath = isCanonical
    ? relPath
    : posix.join(QUESTIONS_DIR, destName(absPath, existingDestNames));
  if (!isCanonical) existingDestNames.add(posix.basename(destRelPath));
  const gitAddDateValue = await gitAddDate(boxRoot, relPath);
  const scopeRef = isCanonical ? "" : await resolveScopeRef(boxRoot, absPath);

  const result = migrateQuestionCard({
    relPath,
    raw,
    destRelPath,
    gitAddDate: gitAddDateValue,
    fallbackAskedAt,
    scopeRef,
  });

  if (result.selectOptionsViolation) {
    totals.violations.push(`${relPath}: select question has fewer than two options`);
  }
  if (result.skippedReason !== null) {
    totals.skipped += 1;
    console.log(`  skip (${result.skippedReason}): ${relPath}`);
    return;
  }
  if (!result.changed) {
    totals.already += 1;
    return;
  }

  const fixes: string[] = [];
  if (result.strippedAnsweredBy) {
    totals.strippedAnsweredBy += 1;
    fixes.push("stripped answered-by");
  }
  if (result.backfilledAskedAt) {
    totals.backfilledAskedAt += 1;
    fixes.push(result.usedFallbackAskedAt ? "backfilled asked-at (no git history, used now)" : "backfilled asked-at");
  }
  if (result.fixedDirectiveTag) {
    totals.fixedDirectiveTag += 1;
    fixes.push("fixed retired <agent-needs-to-know> reference");
  }
  if (result.addedContext) {
    totals.addedContext += 1;
    fixes.push("added context ref to original scope");
  }
  if (result.relocated) {
    totals.relocated += 1;
    totals.renameMap.set(relPath, result.newRelPath);
    fixes.push(`relocated → ${result.newRelPath}`);
  }
  console.log(`  ${relPath}: ${fixes.join(", ")}`);

  if (apply) {
    const destAbs = join(boxRoot, result.newRelPath);
    if (result.relocated) {
      // Ensure box/questions/ exists — a box with only stray question cards
      // (all outside box/questions/) won't have the destination directory yet.
      await mkdir(dirname(destAbs), { recursive: true });
    }
    await writeFile(result.relocated ? destAbs : absPath, result.content);
    if (result.relocated) await rmIfExists(absPath);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const positional = args.find((a) => !a.startsWith("--"));
  if (positional === undefined) {
    console.error(
      "Usage: question-lifecycle-run.ts <boxRoot> [--apply]\n\n" +
        "Strip answered-by, backfill asked-at, relocate stray question cards into box/questions/, " +
        "fix retired <agent-needs-to-know> directive references, and report select-options violations."
    );
    process.exit(1);
  }
  const boxRoot = resolve(positional);
  const files = await findQuestionCards(boxRoot);
  console.log(`Found ${String(files.length)} question card(s) under ${boxRoot}`);
  if (!apply) console.log("Dry run. Pass --apply to convert.");

  const existingDestNames = new Set<string>();
  try {
    for (const name of await readdir(join(boxRoot, QUESTIONS_DIR))) existingDestNames.add(name);
  } catch (_e) {
    // box/questions/ may not exist yet in a box with only stray cards.
  }

  const totals: RunTotals = {
    relocated: 0,
    strippedAnsweredBy: 0,
    backfilledAskedAt: 0,
    fixedDirectiveTag: 0,
    addedContext: 0,
    already: 0,
    skipped: 0,
    violations: [],
    renameMap: new Map(),
  };
  const fallbackAskedAt = getBoxTimeISO(boxRoot);

  for (const absPath of files) {
    await processOne(absPath, { boxRoot, apply, existingDestNames, fallbackAskedAt, totals });
  }

  console.log(
    `\nStripped answered-by: ${String(totals.strippedAnsweredBy)}, backfilled asked-at: ${String(totals.backfilledAskedAt)}, ` +
      `fixed directive tag: ${String(totals.fixedDirectiveTag)}, added context: ${String(totals.addedContext)}, ` +
      `relocated: ${String(totals.relocated)}, already clean: ${String(totals.already)}, skipped: ${String(totals.skipped)}.`
  );

  if (totals.violations.length > 0) {
    console.log(`\n${String(totals.violations.length)} select-options violation(s) — fix by hand, not auto-fixable:`);
    for (const v of totals.violations) console.log(`  ${v}`);
  }

  const { fixedFiles } = await repairExternalRefs(boxRoot, { renameMap: totals.renameMap, apply });
  if (fixedFiles.length > 0) {
    console.log(
      `\nRewrote relocated question-card refs in ${String(fixedFiles.length)} other card(s):`
    );
    for (const f of fixedFiles) console.log(`  ${f}`);
  }

  // Exit 2 (the migrate harness's soft-failure code) when violations remain:
  // the migration DID apply its automatic fixes, but some cards still can't be
  // converted by hand-free means (a select question with fewer than two
  // options fails the schema at load). Exiting 0 would let `cb migrate` record
  // the migration as cleanly applied despite cards that `cb validate` rejects.
  if (totals.violations.length > 0) {
    process.exitCode = 2;
  }
}

// CLI entry — only when run directly (e.g. spawned by `cb migrate`), not when
// imported by a test.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
