/**
 * Report which catalogued capabilities are worth re-reading, ranked by how much their code moved.
 *
 * Usage: pnpm exec tsx beebox/user-stories/pipeline/stale.ts 2026-08-21 [--ids] [--limit N]
 *
 * `--ids` prints a JSON array shaped to paste straight into recheck.workflow.mjs's args.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { parseJsonLine } from "./json-io.ts";
import { staleStories } from "./staleness.ts";
import type { StaleInput } from "./staleness.ts";

const CATALOG = resolve(import.meta.dirname, "../catalog");

const argv = process.argv.slice(2);
const date = argv.find((a) => /^\d{4}-\d{2}-\d{2}$/u.test(a));
const idsOnly = argv.includes("--ids");
const limitIdx = argv.indexOf("--limit");
const limit = limitIdx === -1 ? undefined : Number(argv[limitIdx + 1]);

if (date === undefined) {
  console.error("usage: stale.ts <YYYY-MM-DD> [--ids] [--limit N]");
  process.exit(1);
}

const records = readFileSync(join(CATALOG, `${date}.jsonl`), "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => parseJsonLine<StaleInput>(l));

const ranked = staleStories(records, date);
const shown = limit === undefined ? ranked : ranked.slice(0, limit);

if (idsOnly) {
  console.log(JSON.stringify(shown.map((s) => s.id)));
} else {
  console.log(`${ranked.length} of ${records.length} stories cite a file that changed since they were checked.\n`);
  for (const s of shown) {
    console.log(`  ${String(s.commits).padStart(4)} commits  ${s.id}`);
    console.log(`                ${s.title}`);
    console.log(`                ${s.touched.length} of its cited files: ${s.touched.slice(0, 3).join(", ")}${s.touched.length > 3 ? ", …" : ""}`);
  }
  if (limit !== undefined && ranked.length > limit) {
    console.log(`\n  … ${ranked.length - limit} more (raise --limit)`);
  }
  console.log("\nThis ranks what is WORTH re-reading. A changed file does not prove the story is");
  console.log("wrong, and an unchanged one does not prove it is right — a story can break from a");
  console.log("file it never cited. Feed the top of the list to recheck.workflow.mjs:");
  console.log(`  pnpm exec tsx beebox/user-stories/pipeline/stale.ts ${date} --ids --limit 20`);
}
