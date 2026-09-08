#!/usr/bin/env tsx
/**
 * `schedule-runs-bbx-2026-09` — scheduled-script cards still invoke the
 * retired `cb` command; point them at `bbx`.
 *
 * The 2026-08 rename moved the CLI from `cb` to `bbx` and rewrote the engine,
 * its docs, and the box hooks, but a box's own `_config/schedules/*.scheduled-
 * script.card` files carry the command they run in their `runs:` fields, and
 * nothing rewrote those. Every scheduled job written before the rename has
 * failed since: first as a bare "command not found", and since the `cb`
 * tombstone landed (`issues/bugs/2026-08-31-retired-cb-command-should-direct-
 * to-bbx.md`) as the loud "renamed to bbx" refusal the boxholder saw in two
 * jobs on 2026-09-08. Eight cards on the production boxes carried it.
 *
 * The rewrite is textual and narrow: a `runs:` value (top-level or nested
 * under `then:`) whose command word is exactly `cb` becomes `bbx`, arguments
 * untouched. Nothing else in the card changes — the point is to keep the diff
 * to the one token the rename moved.
 *
 * Like every migrator this leaves the working tree uncommitted; `bbx migrate
 * --sweep` commits it as "Apply migration: schedule-runs-bbx-2026-09".
 *
 * Usage (invoked by `bbx migrate`):
 *   pnpm exec tsx scripts/migrate/schedule-runs-bbx.ts <boxRoot> --apply
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getBoxShape } from "../../src/lib/box-shape.js";
import { errnoCode, errorMessage } from "../../src/lib/error-guards.js";

/** `runs: cb …` at any indentation, the command word alone. */
const RUNS_CB = /^(\s*(?:-\s*)?runs:\s*)cb(?=\s|$)/gmu;

/** The card text with every `runs: cb …` pointed at `bbx`. */
export function rewriteRuns(text: string): string {
  return text.replace(RUNS_CB, "$1bbx");
}

async function scheduleCards(boxRoot: string): Promise<string[]> {
  const dir = path.join(boxRoot, "_config", "schedules");
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((name) => name.endsWith(".scheduled-script.card")).map((name) => path.join(dir, name));
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return [];
    throw e;
  }
}

async function main(): Promise<number> {
  const target = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (target === undefined || target === "") {
    process.stderr.write("usage: schedule-runs-bbx <boxRoot> [--apply]\n");
    return 1;
  }
  const boxRoot = path.resolve(target);
  await getBoxShape(boxRoot); // validates shape and throws a migration-pointing error on a pre-v3 box
  const changed: string[] = [];
  for (const file of await scheduleCards(boxRoot)) {
    const before = await fs.readFile(file, "utf8");
    const after = rewriteRuns(before);
    if (after === before) continue;
    changed.push(path.relative(boxRoot, file));
    if (apply) await fs.writeFile(file, after);
  }
  const verb = apply ? "rewrote" : "would rewrite";
  process.stdout.write(`[schedule-runs-bbx] ${verb} ${String(changed.length)} scheduled-script card(s).\n`);
  for (const rel of changed) process.stdout.write(`  ${rel}\n`);
  return 0;
}

// A doctest imports `rewriteRuns`; only a direct run migrates. Compared by
// exact filename: the doctest that imports this is also named
// `schedule-runs-bbx…`, so a prefix test would run the migration under tap.
if (process.argv[1] !== undefined && path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))) {
  try {
    process.exit(await main());
  } catch (e) {
    process.stderr.write(`[schedule-runs-bbx] failed: ${errorMessage(e)}\n`);
    process.exit(1);
  }
}
