#!/usr/bin/env tsx

/**
 * Retire the `process-pages` procedure from a box.
 *
 * `process-pages` routed `*.record.card` pages from `box/inbox/pages-saved/`
 * and `box/inbox/pages-todo/`. Nothing has written there since the clerk's
 * Save Page action was removed (2026-06-18) and captured pages became
 * `*.webpage.card` files that land in `_content/inbox/` for ordinary triage.
 * The template also still named pre-one-root paths, so on a current box its
 * precheck matched nothing and it skipped every run while looking healthy
 * (`issues/bugs/2026-09-12-procedure-templates-ship-pre-one-root-paths.md`).
 *
 * `installProcedures` never prunes, so this migration removes the box's copy.
 *
 * **Content-gated deletion.** The precedent, `retire-process-captures.ts`,
 * deletes only a copy whose hash matches a shipped stock version. That gate
 * does not work here: box migrations and the Bee Box rename rewrote paths and
 * commands inside procedure cards, so almost no box copy matches any shipped
 * hash. The test is instead whether the copy still reads `pages-saved` — the
 * input that no longer exists. A copy that does is dead whatever else was
 * edited, and is deleted. A copy that does not was repointed by someone, and
 * is parked under `_config/_template-updates/` for review. Git history is the
 * archive either way.
 *
 * Parked mirrors of the old template are deleted: they were upstream versions
 * offered for review, and upstream no longer ships the procedure.
 *
 * Idempotent: a box without the procedure is a clean no-op.
 *
 * Usage:
 *   pnpm exec tsx scripts/migrate/retire-process-pages.ts <boxRoot>           # dry-run
 *   pnpm exec tsx scripts/migrate/retire-process-pages.ts <boxRoot> --apply
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { errnoCode } from "../../src/lib/error-guards.js";

const PROCEDURE_REL = "_config/procedures/process-pages.procedure.card";
const TEMPLATE_UPDATES_DIR = "_config/_template-updates";
/** Where install-template-file parks a mirror of the procedure on a v3 box. */
const PARKED_REL = `${TEMPLATE_UPDATES_DIR}/${PROCEDURE_REL}`;
/** Parked mirrors: the v3 location, and the pre-one-root location as the migration moved it. */
const PARKED_RELS: readonly string[] = [
  PARKED_REL,
  `${TEMPLATE_UPDATES_DIR}/procedures/process-pages.procedure.card`,
];
/** The input only the retired flow ever wrote. */
const DEAD_INPUT = "pages-saved";

async function readFileOrNull(absPath: string): Promise<string | null> {
  try {
    return await fs.readFile(absPath, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
}

export interface RetireProcessPagesResult {
  /** What happened to the active procedure card. */
  procedure: "deleted" | "parked" | "absent";
  /** Box-relative path a repointed copy was parked to, if any. */
  parkedAt?: string;
  /** Parked mirrors of the old template that were removed. */
  removedMirrors: string[];
}

/**
 * Retire process-pages from one box. Pure of process concerns (no argv, no
 * exit) so it doctests directly. With `apply: false` it reports what it WOULD
 * do without writing.
 */
export async function retireProcessPages(
  { boxRoot, apply }: { boxRoot: string; apply: boolean },
): Promise<RetireProcessPagesResult> {
  const result: RetireProcessPagesResult = { procedure: "absent", removedMirrors: [] };
  // Mirrors first, so a repointed copy parked below is not then removed.
  for (const rel of PARKED_RELS) {
    if ((await readFileOrNull(path.join(boxRoot, rel))) === null) continue;
    if (apply) await fs.unlink(path.join(boxRoot, rel));
    result.removedMirrors.push(rel);
  }

  const procAbs = path.join(boxRoot, PROCEDURE_REL);
  const content = await readFileOrNull(procAbs);
  if (content === null) return result;
  if (content.includes(DEAD_INPUT)) {
    if (apply) await fs.unlink(procAbs);
    result.procedure = "deleted";
    return result;
  }
  if (apply) {
    const parkedAbs = path.join(boxRoot, PARKED_REL);
    await fs.mkdir(path.dirname(parkedAbs), { recursive: true });
    await fs.writeFile(parkedAbs, content);
    await fs.unlink(procAbs);
  }
  result.procedure = "parked";
  result.parkedAt = PARKED_REL;
  return result;
}

// CLI entry — only when run directly, not when imported by a doctest.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const boxRoot = args.find((a) => !a.startsWith("--"));
  if (boxRoot === undefined) {
    console.error(
      `Usage: ${process.argv[1]} <boxRoot> [--apply]\n\n` +
        "Retire the process-pages procedure: remove a copy that still reads pages-saved/, " +
        "or park a repointed copy for review.",
    );
    process.exit(1);
  }
  const result = await retireProcessPages({ boxRoot: path.resolve(boxRoot), apply });
  const verb = apply ? "" : " (dry run — pass --apply)";
  switch (result.procedure) {
    case "absent":
      console.log(`process-pages procedure: not present${verb}`);
      break;
    case "deleted":
      console.log(`process-pages procedure: removed${verb}`);
      break;
    case "parked":
      console.warn(
        `process-pages procedure: no longer reads pages-saved/ — parked to ${result.parkedAt ?? "?"} ` +
          `for review, removed from _config/procedures/${verb}`,
      );
      break;
  }
  for (const rel of result.removedMirrors) console.log(`process-pages parked template: removed ${rel}${verb}`);
}
