/**
 * How `bin/issues` prints — the fixed-width issue line, the ranked-hit line,
 * and the one JSON writer. Split out of `bin/issues.ts` purely for size; the
 * column widths and wording are unchanged.
 */

import type { IssueEntry } from "../workstreams-app/src/server/issue-search-model.js";
import type { IndexHit, SearchMode } from "../workstreams-app/src/server/issue-index-query.js";
import type { ParsedValues } from "./issues-args.js";

function truncate(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

export function issueLine(entry: IssueEntry): string {
  const marks = [
    entry.priority === "important" ? "!" : "",
    entry.visibility === "private" ? "P" : "",
    entry.nextAction === null ? "" : "?",
  ].join("");
  return [
    pad(entry.date ?? "----------", 10),
    pad(entry.category, 15),
    pad(marks, 3),
    pad(truncate(entry.title, 58), 58),
    entry.path,
  ].join(" ");
}

function hitLine(hit: IndexHit): string {
  return `${hit.score.toFixed(3).padStart(7)}  ${pad(hit.path, 58)} ${hit.title}`;
}

export function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function reportHits(input: {
  hits: IndexHit[];
  values: ParsedValues;
  mode: SearchMode;
  byPath: Map<string, IssueEntry>;
}): void {
  const { hits, values, mode, byPath } = input;
  if (values.json === true) {
    emitJson({
      mode,
      hits: hits.map((hit) => ({ ...hit, category: byPath.get(hit.path)?.category ?? null })),
    });
    return;
  }
  for (const hit of hits) process.stdout.write(`${hitLine(hit)}\n`);
  process.stdout.write(`${String(hits.length)} hit(s) [${mode}]\n`);
}
