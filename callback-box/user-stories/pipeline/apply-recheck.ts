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
import { resolveId } from "./stable-id.ts";

const CATALOG = resolve(import.meta.dirname, "../catalog");
const RECHECK_ROOT = resolve(import.meta.dirname, "../work/recheck");

const argv = process.argv.slice(2);
const date = argv.find((a) => /^\d{4}-\d{2}-\d{2}$/u.test(a));
const runIdx = argv.indexOf("--run");
const run = runIdx === -1 ? "latest" : argv[runIdx + 1];
const asOfIdx = argv.indexOf("--as-of");
// `lastChecked` must record when the check HAPPENED, not the catalog's date — otherwise a recheck
// stamps a date in the past and staleness never sees changes made between the two.
const asOf = asOfIdx === -1 ? new Date().toISOString().slice(0, 10) : argv[asOfIdx + 1];

if (date === undefined || run === undefined || asOf === undefined) {
  console.error("usage: apply-recheck.ts <YYYY-MM-DD> [--run <name>] [--as-of <YYYY-MM-DD>]");
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
  aliases?: string[]
}

const RECHECK = join(RECHECK_ROOT, run);
if (!existsSync(RECHECK)) {
  console.error(`no recheck output at ${RECHECK} — run recheck.workflow.mjs first (with {run: "${run}"})`);
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
const incompletePanels: string[] = [];
const seen = new Set<string>();

for (const [citedId, v] of verdicts) {
  // Resolve through aliases: a recheck may be citing an id from an issue filed before a reword.
  const r = resolveId(records, citedId);
  if (r === undefined) continue;
  seen.add(citedId);
  r.verdict = v;
  r.lastChecked = asOf;
  updated++;

  // EVERY piece of old evidence is stale now — it describes code that has since changed. Carrying
  // any of it forward is how a re-refuted story renders green: a stale `triage: false-negative`
  // outranks the fresh verdict in statusOf(), and a stale all-satisfied panel reads as a clearance.
  // The browser record is equally stale (it observed the old build) and must not keep a story red
  // after a fix either.
  if (r.panel !== undefined || r.triage !== undefined || r.browser !== undefined) cleared++;
  delete r.panel;
  delete r.triage;
  delete r.browser;

  if (v.verdict !== "accurate") {
    const fresh = panels.get(citedId);
    if (fresh !== undefined && fresh.length >= 3) {
      r.panel = fresh;
    } else if (fresh !== undefined) {
      // A partial panel cannot clear anything (clearing needs all three lenses satisfied), so
      // dropping it leaves the story flagged on the fresh verdict. Fail closed, and say so.
      incompletePanels.push(r.id);
    }
  }
}

for (const id of verdicts.keys()) if (!seen.has(id)) unknown.push(id);

const sorted = records.toSorted((a, b) => a.id.localeCompare(b.id));
writeFileSync(path, `${sorted.map((r) => JSON.stringify(r)).join("\n")}\n`);

console.log(`updated:  ${updated} stories`);
console.log(`cleared:  ${cleared} stories' worth of stale panel/triage/browser evidence`);
if (incompletePanels.length > 0) {
  console.log(`\nWARNING: ${incompletePanels.length} story(ies) got fewer than 3 panel lenses; they stay flagged on the verdict alone:`);
  for (const id of incompletePanels) console.log(`  ${id}`);
}
if (unknown.length > 0) {
  console.log(`\nWARNING: ${unknown.length} recheck result(s) matched no story in the catalog:`);
  for (const id of unknown) console.log(`  ${id}`);
  console.log("An id changes when a story's title is reworded — check the catalog for its new id.");
}
console.log(`\nNow re-render:\n  pnpm exec tsx callback-box/user-stories/pipeline/render.ts > callback-box/user-stories/catalog/${date}.md`);
