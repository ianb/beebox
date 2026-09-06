#!/usr/bin/env tsx
/**
 * CLI entry for `landmark-links-prominence.ts` (the migration logic and its
 * module doc comment live there; this file is just the report printer and
 * arg parsing, split out to stay under the file-length budget). Same
 * convention as every harness-based migrator:
 *
 *   pnpm exec tsx scripts/migrate/landmark-links-prominence-run.ts <boxRoot>            # dry-run
 *   pnpm exec tsx scripts/migrate/landmark-links-prominence-run.ts <boxRoot> --apply
 *
 * Registered in `src/core/migrations.ts` under this file's path.
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { migrateBox, type MigrationReport } from "./landmark-links-prominence.js";

function printReport({ apply, report }: { apply: boolean; report: MigrationReport }): void {
  const verb = apply ? "Marked" : "Would mark";
  console.log(
    `Scanned ${String(report.landmarksScanned)} landmark card(s). ` +
    `${verb} ${String(report.marked.length)} target(s), skipped ${String(report.skipped.length)} entrie(s), ` +
    `${String(report.trimCandidates.length)} trim candidate(s), ${String(report.failed.length)} failed.`,
  );
  if (report.marked.length > 0) {
    console.log(`\n${verb}:`);
    for (const m of report.marked) console.log(`  ${m.landmark}: ${m.ref} -> ${m.target}: prominence: primary`);
  }
  if (report.skipped.length > 0) {
    console.log("\nSkipped:");
    for (const s of report.skipped) console.log(`  ${s.landmark}: ${s.ref}${s.target === null ? "" : ` -> ${s.target}`} — ${s.reason}`);
  }
  if (report.trimCandidates.length > 0) {
    console.log("\nTrim candidates (label-less; the target's own prominence already surfaces it in the derived list):");
    for (const t of report.trimCandidates) console.log(`  ${t.landmark}: ${t.ref} -> ${t.target} (${t.level})`);
  }
  for (const f of report.failed) console.log(`  FAIL ${f.file}: ${f.error}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const boxRootArg = args.find((a) => !a.startsWith("--"));
  if (boxRootArg === undefined) {
    console.error("Usage: landmark-links-prominence-run <boxRoot> [--apply]");
    process.exit(1);
  }
  const report = await migrateBox(resolve(boxRootArg), apply);
  printReport({ apply, report });
  if (report.failed.length > 0) process.exit(2);
}

// Run only when invoked directly, not when imported by a test.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
