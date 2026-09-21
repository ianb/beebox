#!/usr/bin/env tsx

/**
 * Rewrite box-absolute refs still written in the v2 layout (`/store/…`,
 * `/box/inbox/…`, `/content/store/…`) to the v3 path the one-root migration
 * moved their target to.
 *
 * The one-root migration moved every file but could not see every ref. A ref
 * such as `/store/archive/briefs/X.news-brief.card` now names nothing:
 * `resolveRefPath` refuses it because `store/` is outside the box namespace.
 * The v2→v3 path mapping is `mapV2Path` (`src/core/migrations/one-root-mapping.ts`),
 * the same table the one-root migration moved the files with.
 *
 * A ref is rewritten only when all hold: it starts with `/`; it does not
 * already resolve to something on disk; `mapV2Path` maps it to a path inside
 * the box namespace; and that path exists. Everything else is left unchanged,
 * and `bbx validate` keeps reporting it as a broken ref. Cards and `.md` files
 * are scanned; the query and fragment of a ref are kept.
 *
 * Idempotent: a rewritten ref resolves, so a second run leaves it alone.
 * Registered in src/core/migrations.ts before `filename-attach-scope`, so a
 * v2-form `filename.ref` is in v3 form by the time that migration reads it.
 *   pnpm exec tsx scripts/migrate/v2-refs-to-v3.ts <boxRoot>           # dry-run
 *   pnpm exec tsx scripts/migrate/v2-refs-to-v3.ts <boxRoot> --apply
 */

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { listBoxCardFiles, listBoxMarkdownFiles } from "../../src/core/list-cards.js";
import { mapV2Path } from "../../src/core/migrations/one-root-mapping.js";
import { collectCardRefTokens, rewriteCardRefTokens } from "../../src/core/rewrite-card-refs.js";
import { errorMessage } from "../../src/lib/error-guards.js";
import { isInBoxNamespace } from "../../src/lib/box-namespace.js";
import { formatRefSuffix, parseRef, resolveRefPath } from "../../src/shared/ref-path.js";

/**
 * The v3 form of a v2 box-absolute ref, or null when the ref is not one, or
 * when its mapped target is missing. `exists` answers for a box-relative path.
 */
export function v3FormOf(raw: string, exists: (rel: string) => boolean): string | null {
  const parsed = parseRef(raw);
  if (!parsed.path.startsWith("/")) return null;
  const current = resolveRefPath({ ref: parsed.path, kind: "card" });
  if (current !== null && exists(current)) return null;
  const contentRel = parsed.path.slice(1).replace(/^content\//, "");
  const mapped = mapV2Path(contentRel);
  if (mapped.kind !== "move" || !isInBoxNamespace(mapped.newPath) || !exists(mapped.newPath)) return null;
  return `/${mapped.newPath}${formatRefSuffix(parsed)}`;
}

interface Report {
  files: Array<{ file: string; count: number }>;
  failed: Array<{ file: string; error: string }>;
}

export async function migrateBox(boxRoot: string, apply: boolean): Promise<Report> {
  const report: Report = { files: [], failed: [] };
  const exists = (rel: string): boolean => existsSync(path.join(boxRoot, rel));
  const files = [...(await listBoxCardFiles(boxRoot)), ...(await listBoxMarkdownFiles(boxRoot))];
  for (const abs of files) {
    const rel = path.relative(boxRoot, abs).split(path.sep).join("/");
    try {
      const text = await readFile(abs, "utf8");
      const replacements = new Map<string, string>();
      for (const token of collectCardRefTokens({ text, skipFencedCode: true })) {
        const v3 = v3FormOf(token, exists);
        if (v3 !== null) replacements.set(token, v3);
      }
      if (replacements.size === 0) continue;
      const { text: updated, count } = rewriteCardRefTokens({ text, replacements, skipFencedCode: true });
      if (updated === text) continue;
      if (apply) await writeFile(abs, updated);
      report.files.push({ file: rel, count });
    } catch (e) {
      report.failed.push({ file: rel, error: errorMessage(e) });
    }
  }
  return report;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const positional = args.find((a) => !a.startsWith("--"));
  if (positional === undefined) {
    console.error("Usage: v2-refs-to-v3 <boxRoot> [--apply]");
    process.exit(1);
  }
  const report = await migrateBox(path.resolve(positional), apply);
  const total = report.files.reduce((sum, f) => sum + f.count, 0);
  console.log(
    `${apply ? "Rewrote" : "Would rewrite"} ${String(total)} v2-form ref(s) in ${String(report.files.length)} file(s); ` +
      `${String(report.failed.length)} failed.`,
  );
  for (const f of report.files) console.log(`  ${f.file} (${String(f.count)})`);
  for (const f of report.failed) console.log(`  FAIL ${f.file}: ${f.error}`);
  if (report.failed.length > 0) process.exit(2);
}

// Run only when invoked directly (not when imported by a test).
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
