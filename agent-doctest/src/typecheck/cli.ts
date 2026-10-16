/**
 * doctest-typecheck: typecheck `.doctest.md` files and print each error on
 * its markdown line.
 *
 *   doctest-typecheck --project tsconfig.json 'test/**\/*.doctest.md' \
 *     --project src/frontend/tsconfig.json 'src/frontend/test/**\/*.doctest.md'
 *
 * Each `--project` starts a group: the doctests after it are checked under
 * that tsconfig. Arguments are files or globs, relative to the working
 * directory. `--by-dir N` adds a count of errors per directory, N path
 * segments deep. Exits 1 when any error is found.
 */

import { globSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { typecheckDoctests, type DoctestDiagnostic } from "./check.ts";

interface Group {
  tsconfig: string;
  patterns: string[];
}

interface Args {
  groups: Group[];
  byDir: number | null;
}

function usage(problem: string): never {
  process.stderr.write(`doctest-typecheck: ${problem}\nusage: doctest-typecheck [--by-dir N] --project <tsconfig> <doctest file or glob>... [--project …]\n`);
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const groups: Group[] = [];
  let byDir: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--project") {
      const tsconfig = argv[++i];
      if (tsconfig === undefined) usage("--project needs a tsconfig path");
      groups.push({ tsconfig, patterns: [] });
    } else if (arg === "--by-dir") {
      byDir = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isInteger(byDir) || byDir < 1) usage("--by-dir needs a positive depth");
    } else if (arg.startsWith("-")) {
      usage(`unknown option ${arg}`);
    } else {
      const group = groups.at(-1);
      if (!group) usage(`${arg} comes before any --project`);
      group.patterns.push(arg);
    }
  }
  if (groups.length === 0) usage("no --project given");
  return { groups, byDir };
}

function expand(patterns: string[]): string[] {
  const files = new Set<string>();
  for (const pattern of patterns) {
    const matches = globSync(pattern);
    if (matches.length === 0) usage(`${pattern} matches no files`);
    for (const match of matches) files.add(resolve(match));
  }
  return [...files].toSorted();
}

function format(d: DoctestDiagnostic): string {
  const where = `${relative(process.cwd(), d.file)}:${d.line}:${d.column}`;
  const [first = "", ...rest] = d.message.split("\n");
  const note = d.generated ? " (in code the doctest runner generates around this line)" : "";
  return [`${where} - error ${d.code}: ${first}${note}`, ...rest.map((l) => `    ${l}`)].join("\n");
}

function byDirectory(diagnostics: DoctestDiagnostic[], depth: number): string[] {
  const counts = new Map<string, number>();
  for (const d of diagnostics) {
    const dir = dirname(relative(process.cwd(), d.file)).split("/").slice(0, depth).join("/");
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  return [...counts].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([dir, n]) => `${String(n).padStart(6)}  ${dir}`);
}

function main(): void {
  const { groups, byDir } = parseArgs(process.argv.slice(2));
  const all: DoctestDiagnostic[] = [];
  let checked = 0;
  for (const { tsconfig, patterns } of groups) {
    if (patterns.length === 0) usage(`--project ${tsconfig} names no doctests`);
    const files = expand(patterns);
    checked += files.length;
    all.push(...typecheckDoctests({ tsconfig, files }));
  }
  for (const d of all) process.stdout.write(`${format(d)}\n`);
  if (byDir !== null && all.length > 0) process.stdout.write(`\nerrors by directory:\n${byDirectory(all, byDir).join("\n")}\n`);
  const failing = new Set(all.map((d) => d.file)).size;
  process.stdout.write(`\ndoctest-typecheck: ${all.length} errors in ${failing} of ${checked} doctests\n`);
  process.exitCode = all.length > 0 ? 1 : 0;
}

main();
