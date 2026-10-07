/**
 * `pnpm perf:compare <before.json> <after.json>` — medians side by side with
 * the change, for two `pnpm perf:load` result files. With no arguments it
 * compares the two newest result files. Compare only runs taken under the same
 * conditions; the header prints both so a mismatch is visible.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { perfResultsDir } from "./local-hub.js";
import { METRICS, median, metricValues, parseResultFile, type ResultFile } from "./report.js";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function readResult(file: string): Promise<ResultFile> {
  return parseResultFile(await fs.readFile(file, "utf-8"));
}

async function newestTwo(): Promise<[string, string]> {
  const dir = perfResultsDir();
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json") && !f.endsWith(".trace.json")).toSorted();
  const a = files.at(-2);
  const b = files.at(-1);
  if (a === undefined || b === undefined) fail(`need two result files in ${dir}`);
  return [path.join(dir, a), path.join(dir, b)];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [fileA, fileB] = args.length === 2 ? [args[0] ?? "", args[1] ?? ""] : await newestTwo();
  const [a, b] = [await readResult(fileA), await readResult(fileB)];
  const describe = (r: ResultFile): string => `${r.meta.label} (${r.meta.git}, ${r.meta.at}) network=${r.meta.profile} cpu=${r.meta.cpuRate}x cache=${r.meta.cache} box=${r.meta.boxState} runs=${r.runs.length} load=${r.meta.loadAvg?.toFixed(1) ?? "?"}`;
  console.log(`before: ${describe(a)}\nafter:  ${describe(b)}`);
  console.log(`  ${"metric".padEnd(28)}${"before".padStart(9)}${"after".padStart(9)}${"change".padStart(9)}${"%".padStart(7)}`);
  for (const metric of METRICS) {
    const before = median(metricValues(a.runs, metric));
    const after = median(metricValues(b.runs, metric));
    if (before === undefined && after === undefined) continue;
    const delta = before !== undefined && after !== undefined ? after - before : undefined;
    const pct = delta !== undefined && before !== undefined && before !== 0 ? `${Math.round((delta / before) * 100)}%` : "";
    const fmt = (n: number | undefined): string => (n === undefined ? "-" : String(n));
    console.log(`  ${metric.name.padEnd(28)}${fmt(before).padStart(9)}${fmt(after).padStart(9)}${(delta === undefined ? "" : `${delta > 0 ? "+" : ""}${delta}`).padStart(9)}${pct.padStart(7)}`);
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
