/**
 * Failure diff for check() assertions.
 *
 * Single-line values show both sides with a caret at the first difference.
 * Multi-line values get an LCS line diff (`-` expected, `+` actual) with
 * three lines of context and long runs collapsed.
 *
 * Wildcard-aware: an expected line whose own `«…»` pattern matches the
 * aligned actual line counts as equal. This is a display approximation;
 * pass/fail is always the whole-text match in match.ts.
 */

import { compileWildcards } from "./wildcards.js";

const CONTEXT = 3;
/** A run of changed lines longer than this is shown as head + marker + tail. */
const MAX_CHANGE_RUN = 12;
const CHANGE_HEAD = 8;
const CHANGE_TAIL = 3;
/** Past this many DP cells, skip LCS and show the middle as removed-then-added. */
const LCS_CELL_LIMIT = 4_000_000;

type Tag = " " | "-" | "+";
/** One diff line. `text` is the expected line for " " and "-", the actual line for "+". */
export interface Op {
  tag: Tag;
  text: string;
  /** For " " ops: the actual line it matched */
  actual?: string;
}

/** Build a human-readable diff of `actual` against `expected`. */
export function buildDiff(actual: string, expected: string): string {
  const actualLines = actual.split("\n");
  const expectedLines = expected.split("\n");

  if (actualLines.length === 1 && expectedLines.length === 1) {
    return singleLineDiff(actual, expected);
  }

  const ops = alignLines(actualLines, expectedLines);
  return ["- expected", "+ actual", "", ...render(ops)].join("\n");
}

function singleLineDiff(actual: string, expected: string): string {
  const e = JSON.stringify(expected);
  const a = JSON.stringify(actual);
  const lines = [`expected: ${e}`, `  actual: ${a}`];
  let idx = 0;
  while (idx < e.length && idx < a.length && e[idx] === a[idx]) idx++;
  // A caret past a wildcard would point into the pattern, not at a real difference.
  const wildcardAt = e.indexOf("«");
  if (wildcardAt === -1 || idx < wildcardAt) {
    lines.push(`${" ".repeat("expected: ".length + idx)}^`);
  }
  return lines.join("\n");
}

/** Equality of an expected line (maybe with wildcards) against an actual line. */
function lineMatcher(expectedLines: string[]): (i: number, actualLine: string) => boolean {
  const compiled = expectedLines.map((line) => (line.includes("«") ? compileWildcards(line).re : null));
  return (i, actualLine) => {
    const re = compiled[i];
    return re ? re.test(actualLine) : expectedLines[i] === actualLine;
  };
}

/** Align expected and actual lines (wildcard-aware LCS). */
export function alignLines(act: string[], exp: string[]): Op[] {
  const eq = lineMatcher(exp);
  const head: Op[] = [];
  const tail: Op[] = [];
  let lo = 0;
  let expHi = exp.length;
  let actHi = act.length;
  while (lo < expHi && lo < actHi && eq(lo, act[lo] ?? "")) {
    head.push({ tag: " ", text: exp[lo] ?? "", actual: act[lo] ?? "" });
    lo++;
  }
  while (expHi > lo && actHi > lo && eq(expHi - 1, act[actHi - 1] ?? "")) {
    expHi--;
    actHi--;
    tail.unshift({ tag: " ", text: exp[expHi] ?? "", actual: act[actHi] ?? "" });
  }
  const middle = lcsOps({ exp, act, eq, lo, expHi, actHi });
  return [...head, ...middle, ...tail];
}

interface LcsInput {
  exp: string[];
  act: string[];
  eq: (i: number, actualLine: string) => boolean;
  lo: number;
  expHi: number;
  actHi: number;
}

function lcsOps({ exp, act, eq, lo, expHi, actHi }: LcsInput): Op[] {
  const n = expHi - lo;
  const m = actHi - lo;
  const del = (i: number): Op => ({ tag: "-", text: exp[lo + i] ?? "" });
  const add = (j: number): Op => ({ tag: "+", text: act[lo + j] ?? "" });
  if (n * m > LCS_CELL_LIMIT) {
    return [...Array.from({ length: n }, (_, i) => del(i)), ...Array.from({ length: m }, (_, j) => add(j))];
  }

  // L[i][j] = LCS length of exp[i..n) and act[j..m) (relative to lo).
  const width = m + 1;
  const L = new Uint32Array((n + 1) * width);
  const match = (i: number, j: number): boolean => eq(lo + i, act[lo + j] ?? "");
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i * width + j] = match(i, j)
        ? (L[(i + 1) * width + j + 1] ?? 0) + 1
        : Math.max(L[(i + 1) * width + j] ?? 0, L[i * width + j + 1] ?? 0);
    }
  }

  // Walk forward; within a changed stretch, emit removals before additions.
  const ops: Op[] = [];
  let dels: Op[] = [];
  let adds: Op[] = [];
  const flush = (): void => {
    ops.push(...dels, ...adds);
    dels = [];
    adds = [];
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && match(i, j)) {
      flush();
      ops.push({ tag: " ", text: exp[lo + i] ?? "", actual: act[lo + j] ?? "" });
      i++;
      j++;
    } else if (j >= m || (i < n && (L[(i + 1) * width + j] ?? 0) >= (L[i * width + j + 1] ?? 0))) {
      dels.push(del(i++));
    } else {
      adds.push(add(j++));
    }
  }
  flush();
  return ops;
}

/** Render ops as lines, collapsing long equal and changed runs. */
function render(ops: Op[]): string[] {
  const out: string[] = [];
  let start = 0;
  while (start < ops.length) {
    const tag = ops[start]?.tag;
    let end = start;
    while (end < ops.length && ops[end]?.tag === tag) end++;
    const run = ops.slice(start, end);
    if (tag === " ") {
      out.push(...renderEqualRun(run, { atStart: start === 0, atEnd: end === ops.length }));
    } else {
      out.push(...renderChangeRun(run));
    }
    start = end;
  }
  return out;
}

function renderEqualRun(run: Op[], where: { atStart: boolean; atEnd: boolean }): string[] {
  const lines = run.map((op) => `  ${op.text}`);
  const marker = (n: number): string => `  … ${n} unchanged lines …`;
  if (where.atStart && where.atEnd) return lines;
  if (where.atStart) {
    const hidden = lines.length - CONTEXT;
    return hidden >= 2 ? [marker(hidden), ...lines.slice(-CONTEXT)] : lines;
  }
  if (where.atEnd) {
    const hidden = lines.length - CONTEXT;
    return hidden >= 2 ? [...lines.slice(0, CONTEXT), marker(hidden)] : lines;
  }
  const hidden = lines.length - 2 * CONTEXT;
  return hidden >= 2 ? [...lines.slice(0, CONTEXT), marker(hidden), ...lines.slice(-CONTEXT)] : lines;
}

function renderChangeRun(run: Op[]): string[] {
  const tag = run[0]?.tag ?? "+";
  const lines = run.map((op) => `${tag} ${op.text}`);
  if (lines.length <= MAX_CHANGE_RUN) return lines;
  const hidden = lines.length - CHANGE_HEAD - CHANGE_TAIL;
  return [...lines.slice(0, CHANGE_HEAD), `${tag} … ${hidden} more lines …`, ...lines.slice(-CHANGE_TAIL)];
}
