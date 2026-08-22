/**
 * Re-key a frozen catalog from provenance ids to content-derived ones.
 *
 * A one-time migration for the 2026-08-21 run, kept because it is also the shape of the
 * old-to-new mapping a future regeneration needs. The previous id is preserved as `discoveredAs`
 * so the run's own working files (`work/areas/*`, `work/verdicts/*`) can still be traced back.
 *
 * Usage: pnpm exec tsx callback-box/user-stories/pipeline/rekey.ts 2026-08-21
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { parseJsonLine } from "./json-io.ts";
import { assignIds } from "./stable-id.ts";

const CATALOG = resolve(import.meta.dirname, "../catalog");

const date = process.argv[2];
if (date === undefined || !/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
  console.error("usage: rekey.ts <YYYY-MM-DD>");
  process.exit(1);
}

interface Record { id: string, group: string, title: string, discoveredAs?: string }

const path = join(CATALOG, `${date}.jsonl`);
const records = readFileSync(path, "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => parseJsonLine<Record>(l));

const ids = assignIds(records);
const mapping: [string, string][] = [];

for (const r of records) {
  const next = ids.get(r);
  if (next === undefined) continue;
  if (r.discoveredAs === undefined) r.discoveredAs = r.id;
  mapping.push([r.id, next]);
  r.id = next;
}

const sorted = records.toSorted((a, b) => a.id.localeCompare(b.id));
writeFileSync(path, `${sorted.map((r) => JSON.stringify(r)).join("\n")}\n`);

writeFileSync(
  join(CATALOG, `${date}.id-map.json`),
  `${JSON.stringify(Object.fromEntries(mapping), null, 2)}\n`,
);

console.log(`re-keyed ${records.length} stories`);
console.log(`wrote catalog/${date}.id-map.json (old provenance id -> stable id)`);
console.log("\nexamples:");
for (const [from, to] of mapping.slice(0, 3)) console.log(`  ${from}  ->  ${to}`);
