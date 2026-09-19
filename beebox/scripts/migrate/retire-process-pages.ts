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
 * **Stock-gated deletion**, as in the precedent `retire-process-captures.ts`.
 * The active copy is deleted only when it is recognizably unedited: its raw
 * sha256 matches a version we shipped ({@link SHIPPED_PROCEDURE_HASHES}), or
 * the hash the box's own template tracker recorded when it installed the
 * card. Any other copy may carry a boxholder's edit, so it is parked under
 * `_config/_template-updates/` for review and removed from the active
 * directory. Box migrations and the rename rewrote paths inside many box
 * copies, so on those boxes the copy parks; the boxholder deletes it after a
 * look. Git history is the archive either way.
 *
 * Parked mirrors are deleted only when they are exact shipped bytes — what
 * `installTemplateFile` parks. A parked copy with any other content (for
 * example one this migration parked on an earlier run) is left alone.
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
import { isRecord } from "../../src/lib/is-record.js";
import { hashProcedureCard } from "./retire-process-captures.js";

const PROCEDURE_REL = "_config/procedures/process-pages.procedure.card";
const TEMPLATE_UPDATES_DIR = "_config/_template-updates";
/** Where install-template-file parks a mirror of the procedure on a v3 box. */
const PARKED_REL = `${TEMPLATE_UPDATES_DIR}/${PROCEDURE_REL}`;
/** Parked mirrors: the v3 location, and the pre-one-root location as the migration moved it. */
const PARKED_RELS: readonly string[] = [
  PARKED_REL,
  `${TEMPLATE_UPDATES_DIR}/procedures/process-pages.procedure.card`,
];
async function readFileOrNull(absPath: string): Promise<string | null> {
  try {
    return await fs.readFile(absPath, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
}

const TRACKER_REL = "_config/template-versions.json";
/** Tracker keys the card may be recorded under: the v3 path, and the pre-one-root path the migration left behind. */
const TRACKER_KEYS: readonly string[] = [PROCEDURE_REL, "config/procedures/process-pages.procedure.card"];

/**
 * sha256 of the raw bytes of every `process-pages.procedure.card` version we
 * shipped, before and after the Bee Box rename. Recompute with:
 *   git log --format=%h -- <templates path> | xargs -I{} sh -c 'git show {}:<templates path> | shasum -a 256'
 */
export const SHIPPED_PROCEDURE_HASHES: readonly string[] = [
  "181a120ab5fa9d130c9cb09f8f8d7e2fc59ff2b4f2e4e7ab2001eeb51a437094",
  "900c3b3de9bc7151437be0194a865bcb9baeafc29f653a2541c5759fe8105763",
  "b612fc41d67f6bace0a912174aecb756277c2cd569a95d96c45e2f5666a0e2cf",
  "7617cd888f0d30758d7fb4eccd78ad91e0a0ba5bcf79231aa3a87512b6ec826f",
  "b802c5ae516c99cbb84d95d35643d5ed85533210b1f65bdce5239722b8a9c851",
  "bc5e3fa7772cec2be8b5932f01610909bc3282253a2d4b6fcd0f00717259af86",
  "1e330d7e1e798691a9d6bd64c619f3b755ff48560ad121676b136f1537723466",
  "8bb04d25392bf2d5f90fb550a93f81f5792d40bd37a446b7b863e1319b17b19b",
];

/** Hashes the box's template tracker recorded for this card, under either key. */
async function recordedHashes(boxRoot: string): Promise<string[]> {
  const raw = await readFileOrNull(path.join(boxRoot, TRACKER_REL));
  if (raw === null) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) return [];
  return TRACKER_KEYS.flatMap((key) => {
    const entry = parsed[key];
    return isRecord(entry) && typeof entry["sha256"] === "string" ? [entry["sha256"]] : [];
  });
}

export interface RetireProcessPagesResult {
  /** What happened to the active procedure card. */
  procedure: "deleted" | "parked" | "absent";
  /** Box-relative path a non-stock copy was parked to, if any. */
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
  // Mirrors first, so a copy parked below is not then removed. Only exact
  // shipped bytes are removed: anything else there is someone's copy.
  for (const rel of PARKED_RELS) {
    const mirror = await readFileOrNull(path.join(boxRoot, rel));
    if (mirror === null || !SHIPPED_PROCEDURE_HASHES.includes(hashProcedureCard(mirror))) continue;
    if (apply) await fs.unlink(path.join(boxRoot, rel));
    result.removedMirrors.push(rel);
  }

  const procAbs = path.join(boxRoot, PROCEDURE_REL);
  const content = await readFileOrNull(procAbs);
  if (content === null) return result;
  const stock = [...SHIPPED_PROCEDURE_HASHES, ...(await recordedHashes(boxRoot))];
  if (stock.includes(hashProcedureCard(content))) {
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
        "Retire the process-pages procedure: remove a stock copy, " +
        "or park any other copy for review.",
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
        `process-pages procedure: edited or not recognized as stock — parked to ${result.parkedAt ?? "?"} ` +
          `for review, removed from _config/procedures/${verb}`,
      );
      break;
  }
  for (const rel of result.removedMirrors) console.log(`process-pages parked template: removed ${rel}${verb}`);
}
