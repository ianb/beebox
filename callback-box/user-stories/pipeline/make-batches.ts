/**
 * Build verification batches.
 *
 * Verifiers check 3 stories each, to share reading cost. The naive choice — 3 adjacent stories
 * from one reader — is the worst one for independence: siblings share the writer's blind spots,
 * vocabulary, and cited files, so a single anchored verifier can wrongly confirm a whole cluster.
 * These batches are STRATIFIED instead: each batch draws its three stories from three different
 * source units, by round-robin over units. Deterministic (no RNG — workflow scripts forbid it).
 *
 * Usage: pnpm exec tsx callback-box/user-stories/pipeline/make-batches.ts
 * Writes user-stories/work/batches.json and prints a summary.
 */
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { readJson } from "./json-io.ts";

const BASE = resolve(import.meta.dirname, "../work");

interface Story { id: string, sourceFile: string, audience: string }

const { stories } = readJson<{ stories: Story[] }>(join(BASE, "stories.final.json"));

const unitOf = (s: Story): string => s.sourceFile.replace(/\.r\d+\.json$/, "").replace(/\.json$/, "");

// Group by unit, then round-robin across units so consecutive picks come from different readers.
const byUnit = new Map<string, string[]>();
for (const s of stories) {
  const u = unitOf(s);
  if (!byUnit.has(u)) byUnit.set(u, []);
  byUnit.get(u)!.push(s.id);
}

const unitNames = [...byUnit.keys()].toSorted();
const interleaved: string[] = [];
let round = 0;
let placed = 0;
while (placed < stories.length) {
  for (const u of unitNames) {
    const list = byUnit.get(u)!;
    if (round < list.length) {
      interleaved.push(list[round]!);
      placed++;
    }
  }
  round++;
}

const BATCH_SIZE = 3;
const batches: string[][] = [];
for (let i = 0; i < interleaved.length; i += BATCH_SIZE) {
  batches.push(interleaved.slice(i, i + BATCH_SIZE));
}

// Sanity: how many batches are fully cross-unit?
const unitById = new Map(stories.map((s) => [s.id, unitOf(s)]));
const pure = batches.filter((b) => new Set(b.map((id) => unitById.get(id))).size === b.length).length;

writeFileSync(join(BASE, "batches.json"), `${JSON.stringify({ batches }, null, 2)}\n`);

console.log(`${stories.length} stories across ${unitNames.length} units`);
console.log(`${batches.length} batches of up to ${BATCH_SIZE}`);
console.log(`${pure}/${batches.length} batches are fully cross-unit (${Math.round((pure / batches.length) * 100)}%)`);
console.log(`web-ui stories: ${stories.filter((s) => s.audience === "web-ui").length}`);
