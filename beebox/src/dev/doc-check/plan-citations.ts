/**
 * Code comments cite a plan by name: `plan:<name>`, the plan file's basename
 * without `.md`. The name survives the move from `docs/plans/` to
 * `docs/implemented-plans/`, so closing a plan never edits TypeScript and never
 * reruns the typecheck (plan: plan-citations-by-name).
 *
 * This module finds plan paths inside comments of TypeScript and JavaScript
 * files (`--fix` rewrites each to its name) and `plan:<name>` citations that
 * name no plan. Strings and template literals are data, test fixtures and
 * runtime paths among them, and are never read.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "../../lib/typescript/syntax.js";
import { AGENT_DOCS_PREFIX, isFilePathExempt } from "./scan-scope.js";

/** Code files whose comments are held to the plan-citation form. */
export const PLAN_CITATION_SOURCE_RE = /\.(?:ts|tsx|mts|js|mjs)$/;

const PLAN_FILE_RE = /^beebox\/docs\/(?:plans|implemented-plans|unimplemented-plans)\/[^/]+\.md$/;

/** The plan's name when `rel` is a plan file (README.md is not a plan). */
export function planNameOf(rel: string): string | undefined {
  if (!PLAN_FILE_RE.test(rel) || rel.endsWith("/README.md")) return undefined;
  return path.posix.basename(rel, ".md");
}

/** Plan name -> the plan files with that name (more than one is a problem). */
export function planFilesByName(tracked: readonly string[]): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  for (const rel of tracked) {
    const name = planNameOf(rel);
    if (name !== undefined) byName.set(name, [...(byName.get(name) ?? []), rel]);
  }
  return byName;
}

// A path to a plan file: not part of a longer path or URL, optional `./` or
// `../` steps, any directories, then a lifecycle directory and the name.
const PLAN_PATH_RE = /(?<![\w./:@-])((?:\.\.?\/)*(?:[\w.-]+\/)*(?:implemented-|unimplemented-)?plans\/([\w.-]+)\.md(?::L?\d+(?:-L?\d+)?)?)(?![\w/-])/g;
// A citation; the name may hold dots (`x.review`) but does not end in one.
const CITATION_RE = /(?<![\w-])plan:([\w-]+(?:\.[\w-]+)*)/g;

export interface PlanCitationProblem {
  line: number;
  kind: "path" | "unknown";
  token: string;
  /** For `path`: the citation that replaces the token. */
  citation?: string;
}

// Half-open [start, end) spans that look like code to a text scan but are
// data: strings, template parts, regex literals, and JSX text.
function literalSpans(file: ts.SourceFile): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)
      || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isRegularExpressionLiteral(node) || ts.isJsxText(node)) {
      spans.push([node.getStart(file), node.end]);
      return;
    }
    node.forEachChild(visit);
  };
  file.forEachChild(visit);
  return spans.toSorted(([a], [b]) => a - b);
}

// Half-open [start, end) offsets of every comment in `content`: a text scan
// for `//` and `/*` that jumps over each literal span the parser found.
function commentRanges({ rel, content, parse }: { rel: string; content: string; parse: ts.Parse }): Array<[number, number]> {
  const spans = literalSpans(parse({ fileName: path.posix.basename(rel), sourceText: content }));
  const ranges: Array<[number, number]> = [];
  let next = 0;
  for (let i = 0; i < content.length; i++) {
    while (next < spans.length && (spans[next]?.[1] ?? 0) <= i) next++;
    const span = spans[next];
    if (span !== undefined && i >= span[0]) {
      i = span[1] - 1;
      continue;
    }
    if (content[i] !== "/") continue;
    const kind = content[i + 1];
    if (kind !== "/" && kind !== "*") continue;
    const close = kind === "/" ? content.indexOf("\n", i) : content.indexOf("*/", i + 2);
    const end = close === -1 ? content.length : kind === "/" ? close : close + 2;
    ranges.push([i, end]);
    i = end - 1;
  }
  return ranges;
}

function lineAt(content: string, offset: number): number {
  let line = 1;
  for (let i = content.indexOf("\n"); i !== -1 && i < offset; i = content.indexOf("\n", i + 1)) line++;
  return line;
}

function namesPlanFile(rel: string, token: string): boolean {
  const file = token.replace(/:L?\d+(?:-L?\d+)?$/, "");
  const bases = [path.posix.dirname(rel), rel.split("/")[0] ?? ".", "beebox", "."];
  return bases.some((base) => PLAN_FILE_RE.test(path.posix.normalize(path.posix.join(base, file))));
}

interface Found extends PlanCitationProblem { start: number; end: number }

function findInComments({ rel, content, plans, parse }: { rel: string; content: string; plans: ReadonlyMap<string, readonly string[]>; parse: ts.Parse }): Found[] {
  const found: Found[] = [];
  for (const [start, end] of commentRanges({ rel, content, parse })) {
    const comment = content.slice(start, end);
    for (const m of comment.matchAll(PLAN_PATH_RE)) {
      const name = m[2] ?? "";
      // Converted only when the path resolves to a plan file, from the
      // file's directory, its package root, beebox/, or the repo root; a
      // duplicate name is reported elsewhere.
      if (plans.get(name)?.length !== 1 || !namesPlanFile(rel, m[1] ?? "")) continue;
      const at = start + m.index;
      found.push({ start: at, end: at + m[0].length, line: lineAt(content, at), kind: "path", token: m[0], citation: `plan:${name}` });
    }
    for (const m of comment.matchAll(CITATION_RE)) {
      if (plans.has(m[1] ?? "")) continue;
      const at = start + m.index;
      found.push({ start: at, end: at + m[0].length, line: lineAt(content, at), kind: "unknown", token: m[0] });
    }
  }
  return found.toSorted((a, b) => a.start - b.start);
}

export function findPlanCitationProblems({ rel, content, plans, parse }: {
  rel: string; content: string; plans: ReadonlyMap<string, readonly string[]>; parse: ts.Parse;
}): PlanCitationProblem[] {
  return findInComments({ rel, content, plans, parse }).map(({ line, kind, token, citation }) => (citation === undefined ? { line, kind, token } : { line, kind, token, citation }));
}

/** `content` with every plan path in a comment replaced by its citation. */
export function repairPlanCitations({ rel, content, plans, parse }: {
  rel: string; content: string; plans: ReadonlyMap<string, readonly string[]>; parse: ts.Parse;
}): { content: string; rewrites: number } {
  let out = content;
  const paths = findInComments({ rel, content, plans, parse }).filter((f) => f.kind === "path");
  for (const f of paths.toReversed()) out = out.slice(0, f.start) + (f.citation ?? f.token) + out.slice(f.end);
  return { content: out, rewrites: paths.length };
}

export function describePlanCitationProblem(rel: string, p: PlanCitationProblem): string {
  if (p.kind === "path") return `plan path in a code comment: ${rel}:${String(p.line)} \`${p.token}\` -> \`${p.citation ?? ""}\` (cite plans by name; pnpm doc-check --fix rewrites it)`;
  return `unknown plan citation: ${rel}:${String(p.line)} \`${p.token}\` names no file in beebox/docs/{plans,implemented-plans,unimplemented-plans}/`;
}

export function planUniquenessProblems(plans: ReadonlyMap<string, readonly string[]>): string[] {
  return [...plans].filter(([, files]) => files.length > 1).map(([name, files]) => `duplicate plan basename: ${name}.md — ${files.join(", ")} (code cites plans by name; rename one)`);
}

// Code files whose comments must cite plans by name. Historical trees keep
// their comments as written.
function citationSources(tracked: readonly string[]): string[] {
  return tracked.filter((rel) => PLAN_CITATION_SOURCE_RE.test(rel) && !isFilePathExempt(rel) && !rel.startsWith(AGENT_DOCS_PREFIX));
}

function readIfCitesPlans(root: string, rel: string): string | undefined {
  const content = fs.readFileSync(path.join(root, rel), "utf8");
  return content.includes("plans/") || content.includes("plan:") ? content : undefined;
}

/** doc-check's findings: duplicate plan names, then each file's problems. */
export function planCitationProblems({ root, tracked }: { root: string; tracked: readonly string[] }): string[] {
  const plans = planFilesByName(tracked);
  const problems = planUniquenessProblems(plans);
  const parser = ts.createParser();
  try {
    for (const rel of citationSources(tracked)) {
      const content = readIfCitesPlans(root, rel);
      if (content === undefined) continue;
      problems.push(...findPlanCitationProblems({ rel, content, plans, parse: parser.parse }).map((p) => describePlanCitationProblem(rel, p)));
    }
  } finally {
    parser.close();
  }
  return problems;
}

/**
 * doc-check --fix: rewrite plan paths in code comments to citations, print a
 * count, and print what a human must settle (unknown names, duplicate plans).
 * Returns the number of findings left for a human.
 */
export function fixPlanCitations({ root, tracked }: { root: string; tracked: readonly string[] }): { rewrites: number; filesChanged: number; manual: number } {
  const plans = planFilesByName(tracked);
  let rewrites = 0;
  let filesChanged = 0;
  const manual = planUniquenessProblems(plans);
  const parser = ts.createParser();
  try {
    for (const rel of citationSources(tracked)) {
      const content = readIfCitesPlans(root, rel);
      if (content === undefined) continue;
      const repaired = repairPlanCitations({ rel, content, plans, parse: parser.parse });
      if (repaired.rewrites > 0) {
        fs.writeFileSync(path.join(root, rel), repaired.content, "utf8");
        rewrites += repaired.rewrites;
        filesChanged++;
      }
      manual.push(...findPlanCitationProblems({ rel, content: repaired.content, plans, parse: parser.parse }).map((p) => describePlanCitationProblem(rel, p)));
    }
  } finally {
    parser.close();
  }
  if (rewrites > 0) console.log(`cited ${String(rewrites)} plan(s) by name in ${String(filesChanged)} code file(s)`);
  if (manual.length > 0) {
    console.error("\nplan citations (manual — name an existing plan, or rename a duplicate plan):");
    for (const p of manual) console.error(`  ${p}`);
  }
  return { rewrites, filesChanged, manual: manual.length };
}
