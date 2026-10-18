/**
 * The check calls in a converted test file, grouped by the `// doctest:L<n>`
 * marker above each. Static fidelity compares these between the file the
 * converter wrote and the file after a worker's edits: the expected value
 * (last argument) of every check must be unchanged, and a changed actual
 * value (first argument) is listed for review.
 *
 * Arguments are compared as token sequences, so whitespace, comments, quote
 * style, and trailing commas do not count as changes.
 */

import ts from "typescript";

const CHECK_METHODS = new Set(["check", "checkText", "checkThrows"]);
const MARKER = /\/\/ doctest:L(\d+)\b/g;

export interface CheckCall {
  method: string;
  /** The first argument, as canonical tokens. */
  actual: string;
  /** The last argument, as canonical tokens. */
  expected: string;
  /** 1-based line of the call in the file. */
  line: number;
}

/** Each check call under the nearest marker above it; marker 0 holds calls above every marker. */
export type ChecksByMarker = Record<string, CheckCall[]>;

/** A node's tokens joined by spaces: strings by value, no trivia, no trailing commas. */
export function canonical(node: ts.Node, file: ts.SourceFile): string {
  const tokens: string[] = [];
  const visit = (n: ts.Node): void => {
    const children = n.getChildren(file);
    if (children.length > 0) {
      for (const c of children) visit(c);
      return;
    }
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) tokens.push(JSON.stringify(n.text));
    else tokens.push(n.getText(file));
  };
  visit(node);
  return tokens.filter((tok, i) => !(tok === "," && [")", "]", "}"].includes(tokens[i + 1] ?? ""))).join(" ");
}

/** Marker lines in source order, with the file line each sits on. */
export function markers(source: string): { marker: number; line: number }[] {
  const out: { marker: number; line: number }[] = [];
  for (const [i, text] of source.split("\n").entries()) {
    for (const m of text.matchAll(MARKER)) out.push({ marker: Number(m[1]), line: i + 1 });
  }
  return out;
}

/** A check call's marker and its 1-based first and last lines. */
export interface CheckSpan {
  marker: number;
  start: number;
  end: number;
  call: CheckCall;
}

export function checkSpans(source: string, fileName: string): CheckSpan[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const marks = markers(source);
  const out: CheckSpan[] = [];
  const lineOf = (pos: number): number => file.getLineAndCharacterOfPosition(pos).line + 1;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && CHECK_METHODS.has(node.expression.name.text)) {
      const first = node.arguments.at(0);
      const last = node.arguments.at(-1);
      const start = lineOf(node.getStart(file));
      if (first !== undefined && last !== undefined) {
        out.push({
          marker: marks.findLast((m) => m.line <= start)?.marker ?? 0,
          start,
          end: lineOf(node.getEnd()),
          call: { method: node.expression.name.text, actual: canonical(first, file), expected: canonical(last, file), line: start },
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

export function checksByMarker(source: string, fileName: string): ChecksByMarker {
  const out: ChecksByMarker = {};
  for (const span of checkSpans(source, fileName)) (out[String(span.marker)] ??= []).push(span.call);
  return out;
}

export interface StaticReport {
  /** Fidelity failures: a marker missing or repeated, or an expected value changed. */
  problems: string[];
  /** Checks whose actual value changed, which a reviewer reads. */
  changedActuals: string[];
}

/**
 * Compare a file's checks with the converter's. `markerLines` are the
 * manifest's examples: each marker must appear exactly once.
 */
export function compareChecks(opts: { before: ChecksByMarker; source: string; fileName: string; markerLines: readonly number[] }): StaticReport {
  const { before, source, fileName, markerLines } = opts;
  const problems: string[] = [];
  const changedActuals: string[] = [];
  const counts = new Map<number, number>();
  for (const m of markers(source)) counts.set(m.marker, (counts.get(m.marker) ?? 0) + 1);
  for (const line of markerLines) {
    const n = counts.get(line) ?? 0;
    if (n !== 1) problems.push(`marker doctest:L${line} appears ${n} times`);
  }
  const after = checksByMarker(source, fileName);
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const was = before[key] ?? [];
    const now = after[key] ?? [];
    const where = key === "0" ? "above the first marker" : `at doctest:L${key}`;
    if (was.length !== now.length) {
      problems.push(`${where}: ${was.length} checks became ${now.length}`);
      continue;
    }
    for (const [i, w] of was.entries()) {
      const n = now[i];
      if (n === undefined) continue;
      if (n.method !== w.method) problems.push(`${where}: t.${w.method} became t.${n.method} (line ${n.line})`);
      if (n.expected !== w.expected) problems.push(`${where}: expected value changed (line ${n.line}): ${w.expected} → ${n.expected}`);
      if (n.actual !== w.actual) changedActuals.push(`${where} (line ${n.line}): ${w.actual} → ${n.actual}`);
    }
  }
  return { problems, changedActuals };
}
