#!/usr/bin/env tsx
/**
 * `briefing-openers-2026-10` runner: move briefing `openers:` to the place's
 * landmark (`plan.ts` holds the decision). Three phases per box:
 *
 * 1. Plan: read every briefing and the landmark beside it, call
 *    `planOpenerMoves`. Any failure prints each path and exits 1 with nothing
 *    written. Exit 1 is a hard failure: `bbx engine migrate` records no
 *    manifest entry and later migrations wait (`core/migration-sweep.ts`). The
 *    shared harness is not used because its per-file failure is the soft exit 2,
 *    which records the migration (`core/migration-run.ts`). Without `--apply`
 *    the runner stops here and prints the plan.
 * 2. Apply: write each file; a tracked template (the root briefing seed) keeps
 *    its ledger in step through `recordAutomatedTemplateRewrite`.
 * 3. Verify: re-scan every briefing; one still carrying `openers` exits 1.
 *    `--verify` alone runs only this phase, for the post-rollout check.
 *
 * Parked template mirrors under `_config/_template-updates/` are not live cards
 * and are skipped; the installer rewrites them.
 *
 * Usage:
 *   pnpm exec tsx src/scripts/migrate/briefing-openers/run.ts <boxRoot>           # plan only
 *   pnpm exec tsx src/scripts/migrate/briefing-openers/run.ts <boxRoot> --apply
 *   pnpm exec tsx src/scripts/migrate/briefing-openers/run.ts <boxRoot> --verify
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { errnoCode } from "../../../shared/error-guards.js";
import { readVersions, TEMPLATE_UPDATES_DIR } from "../../../core/install-template-file.js";
import { recordAutomatedTemplateRewrite } from "../../../core/template-update.js";
import { boxSlug } from "../../../lib/box-slug.js";
import { planOpenerMoves, readOpeners, type BriefingInput } from "./plan.js";

const SKIP_DIRS = new Set([".git", "node_modules"]);

/** Box-relative paths of every live `*.briefing.card`, sorted. */
async function findBriefings(boxRoot: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(rel: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(path.join(boxRoot, rel), { withFileTypes: true });
    } catch (e) {
      if (errnoCode(e) === "ENOENT") return;
      throw e;
    }
    for (const entry of entries) {
      const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && child !== TEMPLATE_UPDATES_DIR) await walk(child);
      } else if (entry.isFile() && entry.name.endsWith(".briefing.card")) out.push(child);
    }
  }
  await walk("");
  return out.toSorted();
}

/** The first sorted `*.landmark.card` in `dir` (the rule `landmarks.forDir` uses). */
async function landmarkIn(boxRoot: string, dir: string): Promise<{ path: string; text: string } | null> {
  const names = (await fs.readdir(path.join(boxRoot, dir))).filter((name) => name.endsWith(".landmark.card")).toSorted();
  const name = names[0];
  if (name === undefined) return null;
  const rel = dir === "." ? name : `${dir}/${name}`;
  return { path: rel, text: await fs.readFile(path.join(boxRoot, rel), "utf8") };
}

/** Briefings that still carry an `openers` key. */
async function verify(boxRoot: string): Promise<string[]> {
  const left: string[] = [];
  for (const rel of await findBriefings(boxRoot)) {
    const text = await fs.readFile(path.join(boxRoot, rel), "utf8");
    if (readOpeners(text, { nested: false }).kind !== "none") left.push(rel);
  }
  return left;
}

export type RunMode = "plan" | "apply" | "verify";

/** One run over one box. Returns the exit code and the lines it printed. */
export async function runBriefingOpeners({ boxRoot, mode }: { boxRoot: string; mode: RunMode }): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  if (mode !== "verify") {
    const briefings: BriefingInput[] = [];
    for (const rel of await findBriefings(boxRoot)) {
      briefings.push({ path: rel, text: await fs.readFile(path.join(boxRoot, rel), "utf8"), landmark: await landmarkIn(boxRoot, path.posix.dirname(rel)) });
    }
    const plan = planOpenerMoves({ briefings, rootLabel: await boxSlug(boxRoot) });
    if (plan.failures.length > 0) {
      for (const failure of plan.failures) lines.push(`failed (${failure.kind}): ${failure.message}`);
      lines.push(`briefing-openers: ${String(plan.failures.length)} failure(s); nothing written.`);
      return { code: 1, lines };
    }
    const count = (outcome: string): number => plan.outcomes.filter((o) => o.outcome === outcome).length;
    for (const file of plan.writes) lines.push(`${file.before === null ? "create" : "write"} ${file.path}${mode === "plan" ? " (dry run; pass --apply)" : ""}`);
    lines.push(`briefing-openers: moved ${String(count("converted"))}, stock ${String(count("stock"))}, already ${String(count("already"))}, files ${String(plan.writes.length)}.`);
    if (mode === "plan") return { code: 0, lines };
    const versions = await readVersions(boxRoot);
    for (const file of plan.writes) {
      const abs = path.join(boxRoot, file.path);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, file.after, "utf8");
      if (file.before !== null && versions[file.path]?.sha256 !== undefined) {
        await recordAutomatedTemplateRewrite({ boxRoot, relPath: file.path, before: file.before, after: file.after });
      }
    }
  }
  const left = await verify(boxRoot);
  if (left.length > 0) {
    for (const rel of left) lines.push(`still carries openers: ${rel}`);
    lines.push(`briefing-openers: verify failed; ${String(left.length)} briefing(s) still carry openers.`);
    return { code: 1, lines };
  }
  if (mode === "verify") lines.push("briefing-openers: verify clean.");
  return { code: 0, lines };
}

// CLI entry — only when run directly, not when imported by a doctest.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const boxRoot = args.find((a) => !a.startsWith("--"));
  if (boxRoot === undefined) {
    console.error("Usage: briefing-openers/run.ts <boxRoot> [--apply | --verify]\n\nMove briefing openers: to the place's landmark navigation.openers.");
    process.exit(1);
  }
  const mode: RunMode = args.includes("--verify") ? "verify" : args.includes("--apply") ? "apply" : "plan";
  const { code, lines } = await runBriefingOpeners({ boxRoot: path.resolve(boxRoot), mode });
  for (const line of lines) (code === 0 ? console.log : console.error)(line);
  process.exit(code);
}
