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
 *
 * `--only <file>...`, last on the line, narrows the run to those doctests:
 * each is checked under the group whose patterns match it, and a group with
 * none is skipped. A hook passes a commit's staged doctests this way, keeping
 * the package's own file-to-tsconfig mapping in one place. A listed file no
 * group matches is an error.
 *
 * Runs are incremental: each tsconfig keeps TypeScript build info in
 * `node_modules/.cache/doctest-typecheck/` beside it, and a doctest is
 * re-checked only when it or something it imports changed. `--no-cache`
 * checks everything and writes nothing.
 */

import { createHash } from "node:crypto";
import { globSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { typecheckDoctests, type DoctestDiagnostic } from "./check.ts";

interface Group {
  tsconfig: string;
  patterns: string[];
}

interface Args {
  groups: Group[];
  byDir: number | null;
  cache: boolean;
  /** Absolute paths, or null for every doctest the groups match. */
  only: Set<string> | null;
}

function usage(problem: string): never {
  process.stderr.write(`doctest-typecheck: ${problem}\nusage: doctest-typecheck [--by-dir N] [--no-cache] --project <tsconfig> <doctest file or glob>... [--project …] [--only <doctest file>...]\n`);
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const groups: Group[] = [];
  let byDir: number | null = null;
  let cache = true;
  let only: Set<string> | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--only") {
      only = new Set(argv.slice(i + 1).map((file) => resolve(file)));
      break;
    } else if (arg === "--project") {
      const tsconfig = argv[++i];
      if (tsconfig === undefined) usage("--project needs a tsconfig path");
      groups.push({ tsconfig, patterns: [] });
    } else if (arg === "--by-dir") {
      byDir = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isInteger(byDir) || byDir < 1) usage("--by-dir needs a positive depth");
    } else if (arg === "--no-cache") {
      cache = false;
    } else if (arg.startsWith("-")) {
      usage(`unknown option ${arg}`);
    } else {
      const group = groups.at(-1);
      if (!group) usage(`${arg} comes before any --project`);
      group.patterns.push(arg);
    }
  }
  if (groups.length === 0) usage("no --project given");
  return { groups, byDir, cache, only };
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

/** One build-info file per tsconfig, beside it, named so two tsconfigs in one directory do not share. */
function cacheFileFor(tsconfig: string): string {
  const absolute = resolve(tsconfig);
  const tag = createHash("sha256").update(absolute).digest("hex").slice(0, 8);
  return join(dirname(absolute), "node_modules", ".cache", "doctest-typecheck", `${basename(absolute, ".json")}-${tag}.tsbuildinfo`);
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
  const { groups, byDir, cache, only } = parseArgs(process.argv.slice(2));
  const all: DoctestDiagnostic[] = [];
  const unmatched = new Set(only);
  let checked = 0;
  for (const { tsconfig, patterns } of groups) {
    if (patterns.length === 0) usage(`--project ${tsconfig} names no doctests`);
    const files = only === null ? expand(patterns) : expand(patterns).filter((file) => only.has(file));
    for (const file of files) unmatched.delete(file);
    if (files.length === 0) continue;
    checked += files.length;
    all.push(...typecheckDoctests({ tsconfig, files, ...(cache ? { cacheFile: cacheFileFor(tsconfig) } : {}) }));
  }
  if (unmatched.size > 0) {
    usage(`no --project group covers ${[...unmatched].map((file) => relative(process.cwd(), file)).join(", ")}`);
  }
  for (const d of all) process.stdout.write(`${format(d)}\n`);
  if (byDir !== null && all.length > 0) process.stdout.write(`\nerrors by directory:\n${byDirectory(all, byDir).join("\n")}\n`);
  const failing = new Set(all.map((d) => d.file)).size;
  process.stdout.write(`\ndoctest-typecheck: ${all.length} errors in ${failing} of ${checked} doctests\n`);
  process.exitCode = all.length > 0 ? 1 : 0;
}

main();
