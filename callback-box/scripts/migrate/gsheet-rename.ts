#!/usr/bin/env tsx
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Rename the `sheet` card type to `gsheet` (consistency with `gdoc` — both are
 * Google-Drive-synced). Two passes:
 *
 *   1. Rename each `*.sheet.card` file to `*.gsheet.card`. The type comes from
 *      the filename, so the rename *is* the type change — no frontmatter edit.
 *   2. Rewrite inbound references (markdown links, refs) from `.sheet.card` to
 *      `.gsheet.card` across every `.md` / `.card` file in the box, so nothing
 *      dangles.
 *
 * An **XML** `*.sheet.card` (a box that never ran the retired sheet
 * XML→frontmatter migration) is left untouched and reported — renaming it to
 * `.gsheet.card` would leave an unloadable card. Such a box is stuck earlier in
 * the migration queue anyway, so it never reaches this one in the normal `cb
 * migrate` flow; the guard is defensive.
 *
 * Idempotent: a box with no `*.sheet.card` (already renamed) is a no-op.
 * Registered in src/core/migrations.ts. Also:
 *   pnpm exec tsx scripts/migrate/gsheet-rename.ts <boxRoot>           # dry-run
 *   pnpm exec tsx scripts/migrate/gsheet-rename.ts <boxRoot> --apply
 */

import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const SKIP_DIRS = new Set([".git", "node_modules"]);
const XML_MARKER = "content-type: application/x-card+xml";

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

/** Rewrite `.sheet.card` → `.gsheet.card` in a file's text. Exported for tests. */
export function rewriteSheetRefs(text: string): string {
  return text.replaceAll(".sheet.card", ".gsheet.card");
}

interface Report {
  renamed: string[];
  xmlSkipped: string[];
  refsRewritten: string[];
  failed: Array<{ file: string; error: string }>;
}

async function migrateBox(absRoot: string, apply: boolean): Promise<Report> {
  const report: Report = { renamed: [], xmlSkipped: [], refsRewritten: [], failed: [] };

  // Pass 1 — rename the cards (frontmatter only).
  const sheetCards: string[] = [];
  await walk(absRoot, async (f) => {
    if (f.endsWith(".sheet.card")) sheetCards.push(f);
  });
  for (const f of sheetCards) {
    try {
      const raw = await readFile(f, "utf8");
      if (raw.includes(XML_MARKER)) {
        report.xmlSkipped.push(relative(absRoot, f));
        continue;
      }
      const newPath = f.replace(/\.sheet\.card$/, ".gsheet.card");
      if (apply) await rename(f, newPath);
      report.renamed.push(relative(absRoot, f));
    } catch (e) {
      report.failed.push({ file: f, error: errMessage(e) });
    }
  }

  // Pass 2 — rewrite inbound refs in every .md / .card file.
  await walk(absRoot, async (f) => {
    if (!/\.(md|card)$/.test(f)) return;
    try {
      const raw = await readFile(f, "utf8");
      if (!raw.includes(".sheet.card")) return;
      const rewritten = rewriteSheetRefs(raw);
      if (rewritten !== raw) {
        if (apply) await writeFile(f, rewritten);
        report.refsRewritten.push(relative(absRoot, f));
      }
    } catch (e) {
      report.failed.push({ file: f, error: errMessage(e) });
    }
  });

  return report;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const boxRoot = args.filter((a) => !a.startsWith("--"))[0];
  if (boxRoot === undefined) {
    console.error("Usage: gsheet-rename <boxRoot> [--apply]");
    process.exit(1);
  }
  const absRoot = resolve(boxRoot);
  const report = await migrateBox(absRoot, apply);

  console.log(
    `${apply ? "Renamed" : "Would rename"} ${String(report.renamed.length)} *.sheet.card → *.gsheet.card; ` +
    `${apply ? "rewrote" : "would rewrite"} refs in ${String(report.refsRewritten.length)} file(s); ` +
    `${String(report.xmlSkipped.length)} XML card(s) skipped; ${String(report.failed.length)} failed.`,
  );
  for (const f of report.failed) console.log(`  FAIL ${f.file}: ${f.error}`);
  if (report.xmlSkipped.length > 0) {
    console.log(`\n${String(report.xmlSkipped.length)} XML *.sheet.card left as-is (box needs XML→frontmatter first):`);
    for (const f of report.xmlSkipped) console.log(`  ${f}`);
  }
  if (report.failed.length > 0) process.exit(2);
}

// Run only when invoked directly (not when imported by a test).
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
