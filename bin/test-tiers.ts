/**
 * The two test tiers, and the argv that expresses them.
 *
 * `beebox/test/careful.txt` lists the timing-sensitive files that run
 * alone in the batched run instead of on every iteration. `.taprc` cannot
 * express that, and a shell-expanded file list in `package.json` is fragile —
 * a list that expands to nothing leaves a bare `tap`, which falls back to
 * `.taprc`'s includes and runs everything. So the ledger wrapper, already in
 * front of every tap invocation, builds the argv itself.
 *
 * See beebox/docs/plans/change-based-test-selection.md, mechanism C.
 */

import { globSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import type { Tier } from "./test-locks.js";

const REPO_ROOT = resolve(import.meta.dirname, "..");
export const PACKAGE_ROOT = join(REPO_ROOT, "beebox");
const CAREFUL_LIST = "test/careful.txt";

/** A tier list that cannot be trusted. Never silently narrows a run. */
export class TierListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TierListError";
  }
}

// ── the careful list ────────────────────────────────────────────────────────

/** One package-relative test path per line; `#` comments and blanks ignored. */
export function parseCarefulList(text: string): string[] {
  const paths: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line !== "") paths.push(line);
  }
  return paths;
}

/**
 * The careful list, verified against disk.
 *
 * A path that no longer exists fails the run loudly: the alternative is a tier
 * that quietly stops testing what it claims to, which is the failure mode the
 * whole list exists to prevent.
 */
export function readCarefulList(root?: string): string[] {
  const packageRoot = root ?? PACKAGE_ROOT;
  const path = join(packageRoot, CAREFUL_LIST);
  if (!existsSync(path)) return [];
  const paths = parseCarefulList(readFileSync(path, "utf-8"));
  const missing = paths.filter((rel) => !existsSync(join(packageRoot, rel)));
  if (missing.length > 0) {
    throw new TierListError(
      `${CAREFUL_LIST} lists ${missing.length} path(s) that do not exist: ${missing.join(", ")}` +
        " — remove the line or restore the file",
    );
  }
  return paths;
}

// ── what `.taprc` includes ──────────────────────────────────────────────────

interface TaprcPatterns {
  include: string[];
  exclude: string[];
}

/**
 * Read `.taprc`'s own include/exclude rather than restating them. The defaults
 * are what tap itself uses, and are what a fixture package with no `.taprc`
 * gets.
 */
export function taprcPatterns(packageRoot: string): TaprcPatterns {
  const path = join(packageRoot, ".taprc");
  const fallback: TaprcPatterns = {
    include: ["test/**/*.test.ts", "test/**/*.doctest.md"],
    exclude: ["test/manual/**"],
  };
  if (!existsSync(path)) return fallback;
  const parsed: unknown = parse(readFileSync(path, "utf-8"));
  if (!isRecord(parsed)) return fallback;
  return {
    include: stringList(parsed.include) ?? fallback.include,
    exclude: stringList(parsed.exclude) ?? fallback.exclude,
  };
}

/** The parse boundary: YAML hands back `unknown`, and `.taprc` may be anything. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((v): v is string => typeof v === "string") ? value : null;
}

/** Every test file `.taprc` includes and does not exclude, package-relative. */
export function taprcTestFiles(packageRoot: string): string[] {
  const patterns = taprcPatterns(packageRoot);
  const excluded = new Set<string>();
  for (const pattern of patterns.exclude) {
    for (const rel of globSync(pattern, { cwd: packageRoot })) excluded.add(rel);
  }
  const found = new Set<string>();
  for (const pattern of patterns.include) {
    for (const rel of globSync(pattern, { cwd: packageRoot })) {
      if (!excluded.has(rel)) found.add(rel);
    }
  }
  return [...found].toSorted();
}

// ── argv ────────────────────────────────────────────────────────────────────

/**
 * Whether the caller already named the files to run, in which case we do not.
 *
 * "Not a flag" is not enough: `tap --timeout 300` and `tap --grep foo` put a
 * bare `300`/`foo` in argv, and reading those as a file list suppressed the
 * tier's own list — leaving a bare `tap`, which falls back to `.taprc` and
 * runs everything, careful tier included. So an argument counts as a file only
 * if it IS one: a member of the tier lists, or a path that exists on disk.
 */
export function hasExplicitFiles(input: {
  args: string[];
  known: string[];
  isFile: (path: string) => boolean;
}): boolean {
  const known = new Set(input.known);
  return input.args.some((arg) => !arg.startsWith("-") && (known.has(arg) || input.isFile(arg)));
}

/**
 * Does this argument name a file in the package?
 *
 * A directory does not count: `--grep test` would otherwise resolve against
 * `beebox/test/` and be read as a file list. Erring this way runs a
 * superset (the tier list is still appended), never a subset.
 */
function packageFile(packageRoot: string): (path: string) => boolean {
  return (path) => {
    const full = join(packageRoot, path);
    return existsSync(full) && statSync(full).isFile();
  };
}

/**
 * The command to actually run: the caller's, plus the tier's file list when the
 * caller named no files.
 *
 * Anything that is not a bare `tap` invocation passes through untouched — the
 * wrapper fronts other commands too, and `bin/test-select.ts` hands it an
 * explicit selection.
 */
export function tierCommand(input: {
  command: string[];
  tier: Tier;
  /** Every file `.taprc` includes; only read for the ordinary tier. */
  taprcFiles: string[];
  careful: string[];
  /** How an argument is recognised as a real path; defaults to the package. */
  isFile?: (path: string) => boolean;
}): string[] {
  const [executable, ...args] = input.command;
  if (executable !== "tap") return input.command;

  // -j1 is what "carefully" means: the flakes in this tier are contention.
  const flags = input.tier === "careful" && !args.some((a) => a.startsWith("-j")) ? ["-j1"] : [];
  const explicit = hasExplicitFiles({
    args,
    known: [...input.taprcFiles, ...input.careful],
    isFile: input.isFile ?? packageFile(PACKAGE_ROOT),
  });
  if (explicit) return [executable, ...flags, ...args];

  const careful = new Set(input.careful);
  const files =
    input.tier === "careful" ? input.careful : input.taprcFiles.filter((f) => !careful.has(f));
  if (files.length === 0) {
    throw new TierListError(
      `the ${input.tier} tier resolved to no test files — refusing to run a bare \`tap\`,` +
        " which would fall back to .taprc and run everything",
    );
  }
  return [executable, ...flags, ...args, ...files];
}

/** The careful list in the graph's repo-relative vocabulary, for the selector. */
export function carefulExclusions(packageRoot?: string): string[] {
  return readCarefulList(packageRoot ?? PACKAGE_ROOT).map((rel) => `beebox/${rel}`);
}
