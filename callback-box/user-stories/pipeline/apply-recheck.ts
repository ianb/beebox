/**
 * Merge a recheck run back into the frozen catalog.
 *
 * Reads whatever `recheck.workflow.mjs` left in `work/recheck/`, updates those stories' verdicts,
 * panel votes and `lastChecked` date in place, and clears stale evidence — a story that now passes
 * must not keep the panel notes explaining why it used to fail. Everything else in the file is
 * untouched, so the diff shows exactly the capabilities the fix affected.
 *
 * Usage: pnpm exec tsx callback-box/user-stories/pipeline/apply-recheck.ts 2026-08-21
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { parseJsonLine, readJson } from "./json-io.ts";

const CATALOG = resolve(import.meta.dirname, "../catalog");
const RECHECK = resolve(import.meta.dirname, "../work/recheck");

const date = process.argv[2];
if (date === undefined || !/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
  console.error("usage: apply-recheck.ts <YYYY-MM-DD>");
  process.exit(1);
}

interface PanelVote { lens: string, refuted: boolean, note: string }
interface Record {
  id: string
  verdict?: { verdict: string, note: string }
  panel?: PanelVote[]
  triage?: { classification: string, reasoning: string }
  browser?: { status: string, note: string }
  lastChecked?: string
}

if (!existsSync(RECHECK)) {
  console.error(`no recheck output at ${RECHECK} — run recheck.workflow.mjs first`);
  process.exit(1);
}

const verdicts = new Map<string, { verdict: string, note: string }>();
const panels = new Map<string, PanelVote[]>();

for (const f of readdirSync(RECHECK).filter((x) => x.endsWith(".json"))) {
  const parsed = readJson<{ id: string, verdict?: string, note: string, lens?: string, refuted?: boolean }>(
    join(RECHECK, f),
  );
  if (f.endsWith(".verdict.json") && parsed.verdict !== undefined) {
    verdicts.set(parsed.id, { verdict: parsed.verdict, note: parsed.note });
  } else if (parsed.lens !== undefined && parsed.refuted !== undefined) {
    const votes = panels.get(parsed.id);
    const vote = { lens: parsed.lens, refuted: parsed.refuted, note: parsed.note };
    if (votes === undefined) panels.set(parsed.id, [vote]);
    else votes.push(vote);
  }
}

const path = join(CATALOG, `${date}.jsonl`);
const records = readFileSync(path, "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => parseJsonLine<Record>(l));

let updated = 0;
let cleared = 0;
const unknown: string[] = [];
const seen = new Set<string>();

for (const r of records) {
  const v = verdicts.get(r.id);
  if (v === undefined) continue;
  seen.add(r.id);
  r.verdict = v;
  r.lastChecked = date;
  updated++;

  if (v.verdict === "accurate") {
    // The story holds now. Panel notes and a triage classification describe a failure that no
    // longer exists; leaving them would render a cleared story with its old accusation attached.
    if (r.panel !== undefined || r.triage !== undefined) cleared++;
    delete r.panel;
    delete r.triage;
  } else {
    const fresh = panels.get(r.id);
    if (fresh !== undefined) r.panel = fresh;
  }
}

for (const id of verdicts.keys()) if (!seen.has(id)) unknown.push(id);

const sorted = records.toSorted((a, b) => a.id.localeCompare(b.id));
writeFileSync(path, `${sorted.map((r) => JSON.stringify(r)).join("\n")}\n`);

console.log(`updated:  ${updated} stories`);
console.log(`cleared:  ${cleared} stale panel/triage notes`);
if (unknown.length > 0) {
  console.log(`\nWARNING: ${unknown.length} recheck result(s) matched no story in the catalog:`);
  for (const id of unknown) console.log(`  ${id}`);
  console.log("An id changes when a story's title is reworded — check the catalog for its new id.");
}
console.log(`\nNow re-render:\n  pnpm exec tsx callback-box/user-stories/pipeline/render.ts > callback-box/user-stories/catalog/${date}.md`);
