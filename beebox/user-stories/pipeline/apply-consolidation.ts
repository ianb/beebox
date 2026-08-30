/**
 * Apply the consolidation phase's decisions to produce the catalog that gets verified.
 *
 * Reads stories.json + normalize.json + dedup/*.json, applies label corrections and duplicate
 * merges, and writes stories.final.json. Fails closed on any incoherent decision — a merge that
 * silently drops a real capability is exactly the failure this whole pipeline exists to avoid,
 * so anything ambiguous is reported rather than guessed at.
 *
 * Usage: pnpm exec tsx beebox/user-stories/pipeline/apply-consolidation.ts
 */
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { errorMessage } from "../../src/lib/error-guards.ts";

import { readJson } from "./json-io.ts";


const BASE = resolve(import.meta.dirname, "../work");

interface Story {
  id: string
  title: string
  story: string
  group: string
  audience: string
  files: string[]
  evidence: string
  sourceFile: string
  mergedFrom?: string[]
}

const { stories } = readJson<{ stories: Story[] }>(join(BASE, "stories.json"));
const byId = new Map(stories.map((s) => [s.id, { ...s }]));

const fatal: string[] = [];
const notes: string[] = [];

// --- 1. Label corrections -------------------------------------------------
let labelChanges = 0;
const normPath = join(BASE, "normalize.json");
if (existsSync(normPath)) {
  const { changes } = readJson<{ changes: { id: string, field: "group" | "audience", from: string, to: string }[] }>(normPath);
  for (const c of changes ?? []) {
    const s = byId.get(c.id);
    if (!s) { notes.push(`normalize: unknown id ${c.id}`); continue; }
    if (c.field !== "group" && c.field !== "audience") { notes.push(`normalize: bad field ${c.field}`); continue; }
    s[c.field] = c.to;
    labelChanges++;
  }
} else {
  notes.push("normalize.json missing — labels left as the readers assigned them");
}

// --- 2. Duplicate merges --------------------------------------------------
const dedupDir = join(BASE, "dedup");
const mergedInto = new Map<string, string>();   // duplicate id -> survivor id
const survivors = new Set<string>();
let clusters = 0;

if (existsSync(dedupDir)) {
  for (const file of readdirSync(dedupDir).filter((f) => f.endsWith(".json")).toSorted()) {
    let parsed: { clusters?: { keep: string, merge: string[] }[] };
    try {
      parsed = readJson<typeof parsed>(join(dedupDir, file));
    } catch (err) {
      fatal.push(`dedup/${file}: not valid JSON (${errorMessage(err)})`);
      continue;
    }
    for (const c of parsed.clusters ?? []) {
      if (!byId.has(c.keep)) { fatal.push(`dedup/${file}: keeps unknown id ${c.keep}`); continue; }
      const merge = (c.merge ?? []).filter((m) => m !== c.keep);
      let bad = false;
      for (const m of merge) {
        if (!byId.has(m)) { fatal.push(`dedup/${file}: merges unknown id ${m}`); bad = true; }
        const prior = mergedInto.get(m);
        if (prior !== undefined && prior !== c.keep) {
          fatal.push(`dedup/${file}: id ${m} merged into both ${prior} and ${c.keep}`);
          bad = true;
        }
      }
      if (bad) continue;
      if (merge.length === 0) continue;
      clusters++;
      survivors.add(c.keep);
      for (const m of merge) mergedInto.set(m, c.keep);
    }
  }
} else {
  notes.push("dedup/ missing — no duplicates merged");
}

// A survivor that is itself listed as someone else's duplicate would make the merge graph a
// chain rather than a set of stars, and the union below would lose a hop.
for (const keep of survivors) {
  if (mergedInto.has(keep)) {
    fatal.push(`id ${keep} is both a survivor and merged into ${mergedInto.get(keep)} — merge graph is not flat`);
  }
}

if (fatal.length > 0) {
  console.log(`${fatal.length} FATAL:`);
  for (const f of fatal) console.log(`  ✗ ${f}`);
  console.log("\nDo NOT proceed. Fix the dedup decisions first.");
  process.exit(1);
}

// --- 3. Build the final catalog ------------------------------------------
for (const [dup, keep] of mergedInto) {
  const survivor = byId.get(keep)!;
  const victim = byId.get(dup)!;
  survivor.files = [...new Set([...survivor.files, ...victim.files])];
  survivor.mergedFrom = [...(survivor.mergedFrom ?? []), dup];
}

const final = stories
  .map((s) => byId.get(s.id)!)
  .filter((s) => !mergedInto.has(s.id));

const groupCounts = new Map<string, number>();
const audienceCounts = new Map<string, number>();
for (const s of final) {
  groupCounts.set(s.group, (groupCounts.get(s.group) ?? 0) + 1);
  audienceCounts.set(s.audience, (audienceCounts.get(s.audience) ?? 0) + 1);
}

writeFileSync(join(BASE, "stories.final.json"), `${JSON.stringify({ stories: final }, null, 2)}\n`);

console.log(`In:              ${stories.length}`);
console.log(`Label changes:   ${labelChanges}`);
console.log(`Clusters:        ${clusters}`);
console.log(`Folded away:     ${mergedInto.size}`);
console.log(`Out:             ${final.length}`);
console.log("");
for (const g of [...groupCounts.keys()].toSorted()) {
  console.log(`  ${g.padEnd(14)} ${String(groupCounts.get(g)).padStart(4)}`);
}
console.log("");
for (const a of [...audienceCounts.keys()].toSorted()) {
  console.log(`  ${a.padEnd(14)} ${String(audienceCounts.get(a)).padStart(4)}`);
}
if (notes.length > 0) {
  console.log("");
  for (const n of notes) console.log(`  ! ${n}`);
}
console.log("\nOK — wrote user-stories/work/stories.final.json");
