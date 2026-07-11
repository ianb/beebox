
/**
 * Shared scaffold for new box-data migrations.
 *
 * Existing migrators in this directory predate the harness and each carry
 * their own arg parsing / walk / counter loop. New migrators should use
 * `runMigration` so all migrators have consistent flags, output, and exit
 * codes — and so the per-migration code is just the schema-specific
 * conversion logic, nothing else.
 *
 * Example:
 *
 *   ```ts
 *   #!/usr/bin/env tsx
 *   import { runMigration } from "./_harness.js";
 *   import { WarningCollector, checkElement, type ElementSpec } from "./_warnings.js";
 *
 *   const SPEC: ElementSpec = { attrs: ["status"], children: { ... } };
 *
 *   await runMigration({
 *     description: "Convert *.thing.card XML body → flat YAML.",
 *     match: (name) => name.endsWith(".thing.card"),
 *     convert: async (absPath, { warnings }) => {
 *       // read, check shape, write new content if differing — return
 *       // "converted" on success, "already" if the file is already in
 *       // post-migration shape.
 *     },
 *   });
 *   ```
 */

import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { WarningCollector } from "./_warnings.js";
import { WarningCollector as WarningCollectorClass } from "./_warnings.js";
import { errorMessage, errnoCode } from "../../src/lib/error-guards.js";

export type ConvertOutcome = "converted" | "already";

export interface MigrationOptions {
  /** Short description shown in usage errors. */
  description: string;
  /** Predicate selecting which files this migration touches. */
  match: (filename: string) => boolean;
  /**
   * Per-file converter. Receives the absolute path and a shared warning
   * collector. Returns "converted" if the file changed, "already" if it
   * was already in the post-migration shape (idempotent skip). Throws on
   * hard failure; the harness collects errors and reports them at the
   * end rather than aborting on the first failure.
   */
  convert: (
    file: string,
    ctx: { warnings: WarningCollector; apply: boolean },
  ) => Promise<ConvertOutcome>;
}

/** Names skipped during the tree walk. */
const SKIP_DIRS = new Set([".git", "node_modules"]);

async function findMatching(root: string, match: (name: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (errnoCode(e) === "ENOENT") return;
      throw e;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && match(entry.name)) {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out;
}

/**
 * Run a migration end-to-end: arg parsing, walk, dry-run/apply, per-file
 * convert, counter report, warning dump, exit code.
 *
 * Exit codes: 0 on success (or dry-run); 1 on bad usage; 2 if any file
 * failed to convert.
 */
export async function runMigration(opts: MigrationOptions): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const positional = args.find((a) => !a.startsWith("--"));
  const boxRoot = positional;
  if (boxRoot === undefined) {
    const cmd = process.argv[1] ?? "migrate";
    console.error(`Usage: ${cmd} <boxRoot> [--apply]\n\n${opts.description}`);
    process.exit(1);
  }
  const absRoot = resolve(boxRoot);
  const files = await findMatching(absRoot, opts.match);
  console.log(`Found ${String(files.length)} matching file(s) under ${absRoot}`);
  if (!apply) {
    console.log("Dry run. Pass --apply to convert.");
    return;
  }
  const warnings = new WarningCollectorClass();
  let converted = 0;
  let already = 0;
  const failed: Array<{ file: string; error: string }> = [];
  for (const f of files) {
    try {
      const r = await opts.convert(f, { warnings, apply });
      if (r === "converted") converted++;
      else already++;
    } catch (e) {
      failed.push({ file: f, error: errorMessage(e) });
    }
  }
  console.log(
    `Converted ${String(converted)}, already migrated ${String(already)}, failed ${String(failed.length)}.`,
  );
  for (const f of failed) {
    console.log(`  ${relative(absRoot, f.file)}: ${f.error}`);
  }
  warnings.dump(absRoot);
  if (failed.length > 0) process.exit(2);
}
