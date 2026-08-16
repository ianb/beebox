#!/usr/bin/env tsx

/**
 * Retire the `todo-list` card type: convert every `*.todo-list.card` into a
 * sibling `*.doc.card` (same basename) with the items rendered as
 * `{% todo %}`-wrapped markdown, and rewrite any other card/markdown/view
 * that referenced the old path so nothing dangles.
 *
 * See `todo-list-to-doc.ts` for the pure per-card transform (mapping details
 * in its module doc comment) and `docs/implemented-plans/retire-todo-list-schema.md`
 * / `issues/closed/features/2026-07-29-retire-todo-list-schema.md` for why.
 *
 * Doesn't use the shared `scripts/migrate/_harness.ts` scaffold: this
 * migration renames files and needs a box-wide ref-rewrite pass after every
 * card converts (the harness's per-file `convert()` has no post-loop hook
 * and no box-root argument to do that with) — same reason `doc-to-gdoc.ts`
 * (also a rename) rolls its own `main()`.
 *
 * Idempotent: a box with no `*.todo-list.card` files reports "0 found,
 * nothing to do" and changes nothing — once a card converts, its old
 * filename no longer matches, so a re-run can't double-convert it.
 *
 * Usage:
 *   pnpm exec tsx scripts/migrate/todo-list-to-doc-run.ts <boxRoot>           # dry-run
 *   pnpm exec tsx scripts/migrate/todo-list-to-doc-run.ts <boxRoot> --apply
 */

import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { errorMessage, errnoCode } from "../../src/lib/error-guards.js";
import { WarningCollector } from "./_warnings.js";
import { listBoxCardFiles, listBoxMarkdownFiles, listBoxViewFiles } from "../../src/core/list-cards.js";
import { rewriteReferrerRefs, rewriteViewRefs, type Remap } from "../../src/core/rewrite-card-refs.js";
import { convertTodoListCard } from "./todo-list-to-doc.js";

const SKIP_DIRS = new Set([".git", "node_modules"]);

async function findTodoListCards(root: string): Promise<string[]> {
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
      } else if (entry.isFile() && entry.name.endsWith(".todo-list.card")) {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out;
}

interface ConvertedFile {
  oldAbs: string;
  newAbs: string;
}

/**
 * Rewrite every other card/markdown/view that referenced a converted card's
 * old path — same resolution-based approach `cb mv` uses (`rewriteReferrerRefs`
 * / `rewriteViewRefs`), so refs written relative to the referrer, absolute
 * box-root refs, and body `ref="…"` attributes are all caught, not just an
 * exact-string match on the old path.
 */
async function rewriteInboundRefs(params: {
  boxRoot: string;
  converted: ConvertedFile[];
  warnings: WarningCollector;
}): Promise<number> {
  const { boxRoot, converted, warnings } = params;
  if (converted.length === 0) return 0;

  const byOldAbs = new Map(converted.map((c) => [c.oldAbs, c.newAbs]));
  const remap: Remap = (resolvedAbsPath) => byOldAbs.get(resolvedAbsPath) ?? null;
  const convertedNewAbs = new Set(converted.map((c) => c.newAbs));

  const referrers = [
    ...(await listBoxCardFiles(boxRoot)),
    ...(await listBoxMarkdownFiles(boxRoot)),
    ...(await listBoxViewFiles(boxRoot)),
  ];

  let totalUpdated = 0;
  for (const referrerPath of referrers) {
    // The converted cards' own new content carries no refs to their old
    // selves — nothing to rewrite in the file we just wrote.
    if (convertedNewAbs.has(referrerPath)) continue;
    let original: string;
    try {
      original = await readFile(referrerPath, "utf8");
    } catch (e) {
      warnings.push(referrerPath, `could not read during ref rewrite: ${errorMessage(e)}`);
      continue;
    }
    const { text: updated, count } = referrerPath.endsWith(".tsx")
      ? rewriteViewRefs({ boxRoot, viewAbsPath: referrerPath, text: original, remap })
      : rewriteReferrerRefs({ boxRoot, cardAbsPath: referrerPath, text: original, remap });
    if (count === 0 || updated === original) continue;
    await writeFile(referrerPath, updated);
    totalUpdated += count;
    console.log(`  Updated ${String(count)} ref(s) in ${relative(boxRoot, referrerPath)}`);
  }
  return totalUpdated;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const positional = args.find((a) => !a.startsWith("--"));
  if (positional === undefined) {
    console.error("Usage: todo-list-to-doc-run <boxRoot> [--apply]");
    process.exit(1);
  }
  const boxRoot = resolve(positional);

  const files = await findTodoListCards(boxRoot);
  console.log(`Found ${String(files.length)} *.todo-list.card file(s) under ${boxRoot}`);
  if (files.length === 0) {
    console.log("Nothing to do — already migrated (or never had any).");
    return;
  }
  if (!apply) {
    console.log("Dry run. Pass --apply to convert.");
    for (const f of files) console.log(`  ${relative(boxRoot, f)}`);
    return;
  }

  const warnings = new WarningCollector();
  const converted: ConvertedFile[] = [];
  const failed: Array<{ file: string; error: string }> = [];

  for (const file of files) {
    const newAbs = file.replace(/\.todo-list\.card$/, ".doc.card");
    try {
      const raw = await readFile(file, "utf8");
      const result = convertTodoListCard(raw);
      for (const w of result.warnings) warnings.push(file, w);
      await writeFile(newAbs, result.content);
      await unlink(file);
      converted.push({ oldAbs: file, newAbs });
      console.log(`  converted ${relative(boxRoot, file)} -> ${relative(boxRoot, newAbs)}`);
    } catch (e) {
      failed.push({ file, error: errorMessage(e) });
    }
  }

  const refsUpdated = await rewriteInboundRefs({ boxRoot, converted, warnings });

  console.log(
    `Converted ${String(converted.length)}, failed ${String(failed.length)}, ${String(refsUpdated)} inbound ref(s) rewritten.`,
  );
  for (const f of failed) {
    console.log(`  ${relative(boxRoot, f.file)}: ${f.error}`);
  }
  warnings.dump(boxRoot);
  if (failed.length > 0) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
