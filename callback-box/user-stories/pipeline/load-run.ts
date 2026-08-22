/**
 * Load one run's stories and everything anyone concluded about them.
 *
 * Two sources, same shape. During a run the evidence is spread across ~400 files in `work/`;
 * afterwards `freeze.ts` collapses it into `catalog/<date>.jsonl`. Preferring the frozen file is
 * what makes a committed catalog re-renderable from the repository alone — `work/` is scratch and
 * may well be gone.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { parseJsonLine, readJson } from "./json-io.ts";

const BASE = resolve(import.meta.dirname, "../work");
const CATALOG = resolve(import.meta.dirname, "../catalog");

export interface Story {
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

export interface Verdict { verdict: string, note: string }
export interface PanelVote { lens: string, refuted: boolean, note: string }
export interface BrowserCheck { status: string, note: string }
export interface TriageItem { classification: string, reasoning: string }

export interface Run {
  stories: Story[]
  discovered: number
  verdicts: Map<string, Verdict>
  panelVotes: Map<string, PanelVote[]>
  browser: Map<string, BrowserCheck>
  triage: Map<string, TriageItem>
  pageNotes: { page: string, note: string }[]
}

interface Frozen extends Story {
  verdict?: Verdict
  panel?: PanelVote[]
  browser?: BrowserCheck
  triage?: TriageItem
}

function emptyRun(): Run {
  return {
    stories: [],
    discovered: 0,
    verdicts: new Map(),
    panelVotes: new Map(),
    browser: new Map(),
    triage: new Map(),
    pageNotes: [],
  };
}

/** Read every JSON file in a work subdirectory, tolerating a malformed one (the validator reports those). */
function eachWorkFile<T>(dir: string, visit: (parsed: T) => void): void {
  const full = join(BASE, dir);
  if (!existsSync(full)) return;
  for (const f of readdirSync(full).filter((x) => x.endsWith(".json"))) {
    try {
      visit(readJson<T>(join(full, f)));
    } catch (_e) { /* malformed file: the validator is what reports it */ }
  }
}

/** The committed form: one capability per line, its evidence attached. */
function loadFrozen(generated: string): Run {
  const run = emptyRun();
  for (const line of readFileSync(join(CATALOG, `${generated}.jsonl`), "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const r = parseJsonLine<Frozen>(line);
    run.stories.push(r);
    if (r.verdict !== undefined) run.verdicts.set(r.id, r.verdict);
    if (r.panel !== undefined) run.panelVotes.set(r.id, r.panel);
    if (r.browser !== undefined) run.browser.set(r.id, r.browser);
    if (r.triage !== undefined) run.triage.set(r.id, r.triage);
  }
  const meta = readJson<{ discovered: number, pageNotes: { page: string, note: string }[] }>(
    join(CATALOG, `${generated}.meta.json`),
  );
  run.discovered = meta.discovered;
  run.pageNotes.push(...meta.pageNotes);
  return run;
}

/** The mid-run form: evidence spread across the files the agent fleet wrote. */
function loadWorkDir(): Run {
  const run = emptyRun();
  run.stories.push(...readJson<{ stories: Story[] }>(join(BASE, "stories.final.json")).stories);
  run.discovered = readJson<{ stories: Story[] }>(join(BASE, "stories.json")).stories.length;

  eachWorkFile<{ verdicts?: { id: string, verdict: string, note: string }[] }>("verdicts", (p) => {
    for (const v of p.verdicts ?? []) run.verdicts.set(v.id, { verdict: v.verdict, note: v.note });
  });

  eachWorkFile<{ page?: string, pageNotes?: string, checks?: { id: string, status: string, note: string }[] }>(
    "browser",
    (p) => {
      for (const c of p.checks ?? []) run.browser.set(c.id, { status: c.status, note: c.note });
      if (p.pageNotes !== undefined && p.pageNotes.trim() !== "") {
        run.pageNotes.push({ page: p.page ?? "(unnamed page)", note: p.pageNotes });
      }
    },
  );

  eachWorkFile<{ id: string, lens: string, refuted: boolean, note: string }>("panel", (v) => {
    const votes = run.panelVotes.get(v.id);
    if (votes === undefined) run.panelVotes.set(v.id, [{ lens: v.lens, refuted: v.refuted, note: v.note }]);
    else votes.push({ lens: v.lens, refuted: v.refuted, note: v.note });
  });

  eachWorkFile<{ items?: { id: string, classification: string, reasoning: string }[] }>("triage", (p) => {
    for (const it of p.items ?? []) run.triage.set(it.id, { classification: it.classification, reasoning: it.reasoning });
  });

  return run;
}

export function loadRun(generated: string): Run {
  return existsSync(join(CATALOG, `${generated}.jsonl`)) ? loadFrozen(generated) : loadWorkDir();
}
