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

import { readFile, readdir, rename, writeFile } from "node:fs/promises";
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
  failed: Array<{ file: string; error: string }>;
}

async function migrateBox(absRoot: string, apply: boolean): Promise<Report> {
  const report: Report = { renamed: [], refsRewritten: [], failed: [] };

  // Pass 1 — rename the cards.
  const documentCards: string[] = [];
  await walk(absRoot, async (f) => {
    if (f.endsWith(".document.card")) documentCards.push(f);
  });
  for (const f of documentCards) {
    try {
      const newPath = f.replace(/\.document\.card$/, ".pdf.card");
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
    `${String(report.failed.length)} failed.`,
  );
  for (const f of report.failed) console.log(`  FAIL ${f.file}: ${f.error}`);
  if (report.failed.length > 0) process.exit(2);
}

// Run only when invoked directly (not when imported by a test).
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
