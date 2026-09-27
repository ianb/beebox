#!/usr/bin/env tsx

/**
 * Rename the `document` card type to `pdf` (`document` collided with the
 * unrelated `doc.card`; the pipeline only reads PDFs today, so the generic
 * name bought nothing — see `docs/plans/scanner-ingest.md`, Track 4).
 * Two passes:
 *
 *   1. Rename each `*.document.card` file to `*.pdf.card`. The type comes
 *      from the filename, so the rename *is* the type change — no
 *      frontmatter edit.
 *   2. Rewrite inbound references (markdown links, refs) from
 *      `.document.card` to `.pdf.card` across every `.md` / `.card` file in
 *      the box, so nothing dangles.
 *
 * Document cards have always been frontmatter (the type post-dates the
 * XML→frontmatter migration), so there is no XML variant to guard against —
 * unlike `gsheet-rename.ts`, which this script is modeled on.
 *
 * Idempotent: a box with no `*.document.card` (already renamed) is a no-op.
 * Registered in src/core/migrations.ts. Also:
 *   pnpm exec tsx scripts/migrate/document-to-pdf.ts <boxRoot>           # dry-run
 *   pnpm exec tsx scripts/migrate/document-to-pdf.ts <boxRoot> --apply
 */

import { readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const SKIP_DIRS = new Set([".git", "node_modules"]);

function isEnoent(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && e.code === "ENOENT";
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function walk(root: string, onFile: (absPath: string) => Promise<void>): Promise<void> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (e) {
    if (isEnoent(e)) return;
    throw e;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(root, entry.name);
    if (entry.isDirectory()) await walk(full, onFile);
    else if (entry.isFile()) await onFile(full);
  }
}

/** Rewrite `.document.card` → `.pdf.card` in a file's text. Exported for tests. */
export function rewriteDocumentRefs(text: string): string {
  return text.replaceAll(".document.card", ".pdf.card");
}

interface Report {
  renamed: string[];
  refsRewritten: string[];
  /**
   * A rename target that already exists on disk. POSIX `rename()` silently
   * replaces an existing destination, so every target is checked BEFORE any
   * rename runs — a collision is reported and refused, never renamed over.
   */
  collisions: Array<{ from: string; to: string }>;
  failed: Array<{ file: string; error: string }>;
}

async function pathExists(absPath: string): Promise<boolean> {
  try {
    await stat(absPath);
    return true;
  } catch (e) {
    if (isEnoent(e)) return false;
    throw e;
  }
}

/** Exported for tests — runs both passes and returns the report without touching `process`. */
export async function migrateBox(absRoot: string, apply: boolean): Promise<Report> {
  const report: Report = { renamed: [], refsRewritten: [], collisions: [], failed: [] };

  // Pass 1 — rename the cards. Check every destination for a collision
  // BEFORE renaming anything, so a mid-run failure never leaves some cards
  // renamed over their destination while others were merely reported.
  const documentCards: string[] = [];
  await walk(absRoot, async (f) => {
    if (f.endsWith(".document.card")) documentCards.push(f);
  });
  const toRename: Array<{ from: string; to: string }> = [];
  for (const f of documentCards) {
    const newPath = f.replace(/\.document\.card$/, ".pdf.card");
    if (await pathExists(newPath)) {
      report.collisions.push({ from: relative(absRoot, f), to: relative(absRoot, newPath) });
      continue;
    }
    toRename.push({ from: f, to: newPath });
  }
  if (report.collisions.length === 0) {
    for (const { from, to } of toRename) {
      try {
        if (apply) await rename(from, to);
        report.renamed.push(relative(absRoot, from));
      } catch (e) {
        report.failed.push({ file: from, error: errMessage(e) });
      }
    }
  }

  // Pass 2 — rewrite inbound refs in every .md / .card file. Skipped when a
  // collision refused pass 1: rewriting a ref to `.pdf.card` when the card
  // itself was never renamed would point it at a file that doesn't exist.
  if (report.collisions.length === 0) {
    await walk(absRoot, async (f) => {
      if (!/\.(md|card)$/.test(f)) return;
      try {
        const raw = await readFile(f, "utf8");
        if (!raw.includes(".document.card")) return;
        const rewritten = rewriteDocumentRefs(raw);
        if (rewritten !== raw) {
          if (apply) await writeFile(f, rewritten);
          report.refsRewritten.push(relative(absRoot, f));
        }
      } catch (e) {
        report.failed.push({ file: f, error: errMessage(e) });
      }
    });
  }

  return report;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const boxRoot = args.find((a) => !a.startsWith("--"));
  if (boxRoot === undefined) {
    console.error("Usage: document-to-pdf <boxRoot> [--apply]");
    process.exit(1);
  }
  const absRoot = resolve(boxRoot);
  const report = await migrateBox(absRoot, apply);

  console.log(
    `${apply ? "Renamed" : "Would rename"} ${String(report.renamed.length)} *.document.card → *.pdf.card; ` +
    `${apply ? "rewrote" : "would rewrite"} refs in ${String(report.refsRewritten.length)} file(s); ` +
    `${String(report.collisions.length)} collision(s); ${String(report.failed.length)} failed.`,
  );
  if (report.collisions.length > 0) {
    console.log(`\n${String(report.collisions.length)} rename target(s) already exist — refusing to overwrite:`);
    for (const c of report.collisions) console.log(`  COLLISION ${c.from} → ${c.to} (target already exists)`);
  }
  for (const f of report.failed) console.log(`  FAIL ${f.file}: ${f.error}`);
  if (report.failed.length > 0 || report.collisions.length > 0) process.exit(2);
}

// Run only when invoked directly (not when imported by a test).
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
