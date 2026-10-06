/**
 * The agent guide's linter: checks a rendered guide (`renderAgentGuideLines`)
 * against its ledger. What a machine can check, it checks here; what it cannot
 * (whether a sentence serves its row) is the editing agent's job, set out in
 * `guide.md`'s header comment and docs/agent-guide.md.
 *
 * Checks, in order:
 * - every cited id is a ledger row;
 * - in each covered section (`lint.covered_sections`), every `law` and `core`
 *   row is cited at least once, and uncited words stay within
 *   `budget.uncited_words_per_section`;
 * - no comment from `guide.md` survives into the stripped render;
 * - the DOCID marker is the rendered file's first line;
 * - the rendered file is within `budget.guide_words`, and the always-loaded
 *   total (when measured) within `budget.always_loaded_words`.
 */

import { AGENT_GUIDE_DIR, AGENT_GUIDE_FILE, readDocId, withDocId } from "../docs-gen/shared.js";
import type { Ledger, LedgerRow } from "./ledger-schema.js";
import { strippedText, type GuideLine } from "./render.js";

const GUIDE_PATH = `${AGENT_GUIDE_DIR}/${AGENT_GUIDE_FILE}`;
const HEADING = /^#{1,6} /;
const SUBSECTION_HANDLE = /^### ([A-Z]+(?:_[A-Z]+)*)(?: — |$)/;

export interface GuideLintReport {
  failures: string[];
  /** Words in the rendered file, DOCID line included (as `wc -w` counts). */
  guideWords: number;
  /** Uncited words per `## ` section, for every section. */
  uncitedWords: Record<string, number>;
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Content lines of a section that no citation covers, grouped into passages. */
function uncitedPassages(lines: GuideLine[], section: string): string[][] {
  const passages: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.section !== section || line.comment) continue;
    const content = line.text.trim() !== "" && !HEADING.test(line.text);
    if (content && line.rules.length === 0) {
      current.push(line.text);
      continue;
    }
    if (current.length > 0) passages.push(current);
    current = [];
  }
  if (current.length > 0) passages.push(current);
  return passages;
}

/** The `## ` section a row's handle falls in: itself, or the section holding its `### ` heading. */
function rowSection(row: LedgerRow, lines: GuideLine[]): string {
  for (const line of lines) {
    if (SUBSECTION_HANDLE.exec(line.text)?.[1] === row.handle && line.section !== null) return line.section;
  }
  return row.handle;
}

function citationFailures(ledger: Ledger, lines: GuideLine[]): string[] {
  const rowIds = new Set(ledger.rows.map((r) => r.id));
  const cited = new Set<string>();
  const failures: string[] = [];
  for (const line of lines) {
    if (!line.comment) continue;
    for (const id of line.rules) {
      cited.add(id);
      if (!rowIds.has(id)) failures.push(`${line.section ?? "preamble"}: cites "${id}", which is not a row in ledger.yaml`);
    }
  }
  const covered = new Set(ledger.lint.covered_sections);
  for (const row of ledger.rows) {
    const mustCite = row.bin === "law" || row.bin === "core";
    if (mustCite && !cited.has(row.id) && covered.has(rowSection(row, lines))) {
      failures.push(`${row.handle}: row "${row.id}" (${row.bin}) is not cited in guide.md`);
    }
  }
  return failures;
}

function allowanceFailures(ledger: Ledger, { uncitedWords, lines }: { uncitedWords: Record<string, number>; lines: GuideLine[] }): string[] {
  const allowance = ledger.budget.uncited_words_per_section;
  const failures: string[] = [];
  for (const section of ledger.lint.covered_sections) {
    const count = uncitedWords[section] ?? 0;
    if (count <= allowance) continue;
    const largest = uncitedPassages(lines, section).toSorted((a, b) => words(b.join(" ")) - words(a.join(" ")))[0];
    failures.push(`${section}: ${String(count)} uncited words (allowance ${String(allowance)}); largest uncited passage starts "${largest?.[0] ?? ""}"`);
  }
  return failures;
}

function leakFailures(lines: GuideLine[]): string[] {
  return lines
    .filter((l) => !l.comment && (l.origin === "document" ? l.text.includes("<!--") : l.text.includes("<!-- rules:")))
    .map((l) => `comment leaked into the render: ${l.text}`);
}

export function lintGuide(params: {
  ledger: Ledger;
  lines: GuideLine[];
  /** The `agent-context` always-loaded total for the box, when measured. */
  alwaysLoadedWords?: number | undefined;
  /** Assert the budget ceilings (off for a fixture whose size is only reported). */
  checkBudget: boolean;
}): GuideLintReport {
  const { ledger, lines, alwaysLoadedWords, checkBudget } = params;
  const rendered = withDocId({ relativePath: GUIDE_PATH, content: strippedText(lines) });
  const guideWords = words(rendered);
  const sections = new Set(lines.flatMap((l) => (l.section === null ? [] : [l.section])));
  const uncitedWords: Record<string, number> = {};
  for (const section of sections) {
    uncitedWords[section] = uncitedPassages(lines, section).reduce((n, p) => n + words(p.join(" ")), 0);
  }

  const failures = [
    ...citationFailures(ledger, lines),
    ...allowanceFailures(ledger, { uncitedWords, lines }),
    ...leakFailures(lines),
  ];
  if (readDocId(rendered) !== GUIDE_PATH) failures.push("the DOCID marker is not the rendered guide's first line");
  if (checkBudget && guideWords > ledger.budget.guide_words) {
    failures.push(`the rendered guide is ${String(guideWords)} words, over budget.guide_words ${String(ledger.budget.guide_words)}`);
  }
  if (checkBudget && alwaysLoadedWords !== undefined && alwaysLoadedWords > ledger.budget.always_loaded_words) {
    failures.push(`always-loaded context is ${String(alwaysLoadedWords)} words, over budget.always_loaded_words ${String(ledger.budget.always_loaded_words)}`);
  }
  return { failures, guideWords, uncitedWords };
}
