#!/usr/bin/env tsx
/**
 * `retire-memo-2026-10` runner: every `*.memo.card` becomes a `*.doc.card`,
 * and a recording moves under an `audio` card in the doc's attach scope
 * (`plan.ts` holds the decision; docs/plans/retire-memo.md, Track D). Phases:
 *
 * 1. Plan: read every card and `.md` file and list every file, call
 *    `planRetireMemo`. Any failure prints each path and exits 1 with nothing
 *    written: `bbx engine migrate` records no manifest entry and later
 *    migrations wait. The shared harness is not used because its per-file
 *    failure is the soft exit 2, which records the migration. Without
 *    `--apply` the runner stops here and prints the plan.
 * 2. Apply, in an order a rerun can resume from: audio cards, recording moves
 *    (annex links kept valid), docs, referrers, then memo deletes. Every write
 *    is atomic.
 * 3. Verify: no memo is left, and every doc and audio card written parses.
 *    `--verify` alone runs only this phase.
 *
 * Before planning, box code (`src/`, `_config/` scripts and JSON) that names
 * memo cards is printed as a warning; conversion still runs (boxholder,
 * 2026-10-16). A box view selecting `*.memo.card` shows nothing afterwards.
 *
 * Generated guidance (`.claude/`, `.agents/`), parked template mirrors
 * (`_config/_template-updates/`), `.git` and `node_modules` are skipped; the
 * generators and installer rewrite them.
 *
 * Usage:
 *   pnpm exec tsx src/scripts/migrate/retire-memo/run.ts <boxRoot>           # plan only
 *   pnpm exec tsx src/scripts/migrate/retire-memo/run.ts <boxRoot> --apply
 *   pnpm exec tsx src/scripts/migrate/retire-memo/run.ts <boxRoot> --verify
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { errnoCode, errorMessage } from "../../../shared/error-guards.js";
import { TEMPLATE_UPDATES_DIR } from "../../../core/install-template-file.js";
import { writeFileAtomic } from "../../../lib/atomic-write.js";
import { movePathPreservingAnnexSymlink } from "../../../core/card-files/move-phase2.js";
import { parseCardText } from "../../../core/card-io.js";
import { createCardSchemaMap } from "../../../schemas.js";
import { planRetireMemo, type PlannedWrite } from "./plan.js";

const SKIP_DIRS = new Set([".git", "node_modules", ".claude", ".agents"]);
const TEXT_SUFFIXES = [".card", ".md"];
const CODE_SUFFIXES = [".ts", ".tsx", ".js", ".mjs", ".json"];
const CODE_DIRS = ["src", "_config"];
const MEMO_IN_CODE = /\.memo\.card|["']memo["']/;

/** Every file under `rel`, box-relative and sorted, with whether it is a regular file. */
async function walk(boxRoot: string, rel: string): Promise<Array<{ path: string; regular: boolean }>> {
  let entries;
  try {
    entries = await fs.readdir(path.join(boxRoot, rel), { withFileTypes: true });
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return [];
    throw e;
  }
  const out: Array<{ path: string; regular: boolean }> = [];
  for (const entry of entries) {
    const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && child !== TEMPLATE_UPDATES_DIR) out.push(...await walk(boxRoot, child));
    } else {
      out.push({ path: child, regular: entry.isFile() });
    }
  }
  return out.toSorted((a, b) => a.path.localeCompare(b.path));
}

/** Box code that names memo cards: printed, not fixed. */
async function codeWarnings(boxRoot: string): Promise<string[]> {
  const lines: string[] = [];
  for (const dir of CODE_DIRS) {
    for (const file of await walk(boxRoot, dir)) {
      if (!file.regular || !CODE_SUFFIXES.some((suffix) => file.path.endsWith(suffix))) continue;
      const text = await fs.readFile(path.join(boxRoot, file.path), "utf8");
      if (MEMO_IN_CODE.test(text)) lines.push(`warning: ${file.path} names memo cards; it needs updating by hand after this migration`);
    }
  }
  return lines;
}

async function memosLeft(boxRoot: string): Promise<string[]> {
  return (await walk(boxRoot, "")).map((f) => f.path).filter((p) => p.endsWith(".memo.card"));
}

async function verify(boxRoot: string, written: PlannedWrite[]): Promise<string[]> {
  const problems = (await memosLeft(boxRoot)).map((p) => `memo left: ${p}`);
  const schemas = await createCardSchemaMap(boxRoot);
  for (const write of written) {
    if (write.kind === "referrer") continue;
    const abs = path.join(boxRoot, write.path);
    try {
      parseCardText(await fs.readFile(abs, "utf8"), { source: abs, schemas });
    } catch (e) {
      problems.push(`does not parse: ${write.path}: ${errorMessage(e)}`);
    }
  }
  return problems;
}

export type RunMode = "plan" | "apply" | "verify";

/** One run over one box. Returns the exit code and the lines it printed. */
export async function runRetireMemo({ boxRoot, mode }: { boxRoot: string; mode: RunMode }): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  let written: PlannedWrite[] = [];
  if (mode !== "verify") {
    lines.push(...await codeWarnings(boxRoot));
    const all = await walk(boxRoot, "");
    const texts = new Map<string, string>();
    for (const file of all) {
      if (file.regular && TEXT_SUFFIXES.some((suffix) => file.path.endsWith(suffix))) texts.set(file.path, await fs.readFile(path.join(boxRoot, file.path), "utf8"));
    }
    const plan = planRetireMemo({ texts, files: new Set(all.map((f) => f.path)) });
    if (plan.failures.length > 0) {
      for (const failure of plan.failures) lines.push(`failed: ${failure}`);
      lines.push(`retire-memo: ${String(plan.failures.length)} failure(s); nothing written.`);
      return { code: 1, lines };
    }
    const dry = mode === "plan" ? " (dry run; pass --apply)" : "";
    for (const line of plan.dropped) lines.push(`dropped ${line}`);
    for (const write of plan.writes) lines.push(`${write.kind} ${write.path}${dry}`);
    for (const move of plan.moves) lines.push(`move ${move.from} → ${move.to}${dry}`);
    for (const memo of plan.deletes) lines.push(`delete ${memo}${dry}`);
    lines.push(`retire-memo: memos ${String(plan.deletes.length)}, recordings ${String(plan.moves.length)}, referrers ${String(plan.writes.filter((w) => w.kind === "referrer").length)}.`);
    if (mode === "plan") return { code: 0, lines };
    const write = async (w: PlannedWrite): Promise<void> => {
      const abs = path.join(boxRoot, w.path);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await writeFileAtomic(abs, { content: w.after });
    };
    for (const w of plan.writes.filter((x) => x.kind === "audio")) await write(w);
    for (const move of plan.moves) await movePathPreservingAnnexSymlink(path.join(boxRoot, move.from), path.join(boxRoot, move.to));
    for (const w of plan.writes.filter((x) => x.kind === "doc")) await write(w);
    for (const w of plan.writes.filter((x) => x.kind === "referrer")) await write(w);
    for (const memo of plan.deletes) await fs.rm(path.join(boxRoot, memo));
    written = plan.writes;
  }
  const problems = await verify(boxRoot, written);
  if (problems.length > 0) {
    lines.push(...problems, `retire-memo: verify failed; ${String(problems.length)} problem(s).`);
    return { code: 1, lines };
  }
  if (mode === "verify") lines.push("retire-memo: verify clean.");
  return { code: 0, lines };
}

// CLI entry — only when run directly, not when imported by a doctest.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const boxRoot = args.find((a) => !a.startsWith("--"));
  if (boxRoot === undefined) {
    console.error("Usage: retire-memo/run.ts <boxRoot> [--apply | --verify]\n\nConvert every memo card into a doc card.");
    process.exit(1);
  }
  const mode: RunMode = args.includes("--verify") ? "verify" : args.includes("--apply") ? "apply" : "plan";
  const { code, lines } = await runRetireMemo({ boxRoot: path.resolve(boxRoot), mode });
  for (const line of lines) (code === 0 ? console.log : console.error)(line);
  process.exit(code);
}
