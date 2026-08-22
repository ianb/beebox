/**
 * Freeze a run's evidence into one committed file.
 *
 * `work/` is disposable: 400+ files an agent fleet wrote during a run. But the verifier notes,
 * panel votes, browser observations and triage reasoning that fill the catalog's verification
 * blocks live only there — so a catalog rendered straight from `work/` stops being reproducible
 * the moment that directory is cleaned, and the evidence behind every ✅ goes with it.
 *
 * This collapses a run into `catalog/<date>.jsonl`: every story plus everything anyone concluded
 * about it, one capability per line so git can diff it. `render.ts` prefers that file and falls back to `work/`, so re-rendering a committed
 * catalog needs nothing but the repository.
 *
 * Usage: pnpm exec tsx callback-box/user-stories/pipeline/freeze.ts 2026-08-21
 */
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { readJson } from "./json-io.ts";

const BASE = resolve(import.meta.dirname, "../work");
const CATALOG = resolve(import.meta.dirname, "../catalog");

const date = process.argv[2];
if (date === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("usage: freeze.ts <YYYY-MM-DD>");
  process.exit(1);
}

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

/** Read every JSON file in a work subdirectory, tolerating a malformed one. */
function eachFile<T>(dir: string, visit: (parsed: T) => void): void {
  const full = join(BASE, dir);
  if (!existsSync(full)) return;
  for (const f of readdirSync(full).filter((x) => x.endsWith(".json"))) {
    try {
      visit(readJson<T>(join(full, f)));
    } catch (_e) { /* the validator is what reports malformed files */ }
  }
}

const { stories } = readJson<{ stories: Story[] }>(join(BASE, "stories.final.json"));
const discovered = readJson<{ stories: Story[] }>(join(BASE, "stories.json")).stories.length;

const verdicts: Record<string, { verdict: string, note: string }> = {};
eachFile<{ verdicts?: { id: string, verdict: string, note: string }[] }>("verdicts", (p) => {
  for (const v of p.verdicts ?? []) verdicts[v.id] = { verdict: v.verdict, note: v.note };
});

const panel: Record<string, { lens: string, refuted: boolean, note: string }[]> = {};
eachFile<{ id: string, lens: string, refuted: boolean, note: string }>("panel", (v) => {
  const votes = panel[v.id] ?? [];
  votes.push({ lens: v.lens, refuted: v.refuted, note: v.note });
  panel[v.id] = votes;
});

const browser: Record<string, { status: string, note: string }> = {};
const pageNotes: { page: string, note: string }[] = [];
eachFile<{ page?: string, pageNotes?: string, checks?: { id: string, status: string, note: string }[] }>(
  "browser",
  (p) => {
    for (const c of p.checks ?? []) browser[c.id] = { status: c.status, note: c.note };
    if (p.pageNotes !== undefined && p.pageNotes.trim() !== "") {
      pageNotes.push({ page: p.page ?? "(unnamed page)", note: p.pageNotes });
    }
  },
);

const triage: Record<string, { classification: string, reasoning: string }> = {};
eachFile<{ items?: { id: string, classification: string, reasoning: string }[] }>("triage", (p) => {
  for (const it of p.items ?? []) triage[it.id] = { classification: it.classification, reasoning: it.reasoning };
});

// One line per capability, sorted by id, evidence attached inline.
//
// The format is chosen for git, not for elegance. A pretty-printed blob keyed by story id orders
// its keys by whatever readdir returned, so a re-run reshuffles the whole file and every diff is
// noise. Sorted JSONL means one capability is one line: a re-run that changes three stories shows
// three changed lines, and `git log -p` on this file is a readable history of what the product
// could do. Each line is valid JSON; the file is valid JSONL.
const records = stories
  .map((s) => ({
    ...s,
    verdict: verdicts[s.id],
    panel: panel[s.id],
    browser: browser[s.id],
    triage: triage[s.id],
  }))
  .toSorted((a, b) => a.id.localeCompare(b.id));

const lines = records.map((r) => JSON.stringify(r)).join("\n");
writeFileSync(join(CATALOG, `${date}.jsonl`), `${lines}\n`);

// Run-level facts that are not per-story. Small, and separate so the big file stays uniform.
const meta = {
  generated: date,
  scope: "callback-box/",
  discovered,
  retained: stories.length,
  pageNotes: pageNotes.toSorted((a, b) => a.page.localeCompare(b.page)),
};
writeFileSync(join(CATALOG, `${date}.meta.json`), `${JSON.stringify(meta, null, 2)}\n`);

console.log(`stories:    ${stories.length} (of ${discovered} discovered)`);
console.log(`verdicts:   ${Object.keys(verdicts).length}`);
console.log(`panel:      ${Object.keys(panel).length} stories re-examined`);
console.log(`browser:    ${Object.keys(browser).length} checks, ${pageNotes.length} page reports`);
console.log(`triage:     ${Object.keys(triage).length}`);
console.log(`\nwrote catalog/${date}.jsonl + catalog/${date}.meta.json`);
