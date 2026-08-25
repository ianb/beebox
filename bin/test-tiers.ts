/**
 * The two test tiers, and the argv that expresses them.
 *
 * `callback-box/test/careful.txt` lists the timing-sensitive files that run
 * alone in the batched run instead of on every iteration. `.taprc` cannot
 * express that, and a shell-expanded file list in `package.json` is fragile —
 * a list that expands to nothing leaves a bare `tap`, which falls back to
 * `.taprc`'s includes and runs everything. So the ledger wrapper, already in
 * front of every tap invocation, builds the argv itself.
 *
 * See callback-box/docs/plans/change-based-test-selection.md, mechanism C.
 */

import { globSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import type { Tier } from "./test-locks.js";

const REPO_ROOT = resolve(import.meta.dirname, "..");
export const PACKAGE_ROOT = join(REPO_ROOT, "callback-box");
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
export function readCarefulList(packageRoot: string = PACKAGE_ROOT): string[] {
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
  if (typeof parsed !== "object" || parsed === null) return fallback;
  const config = parsed as { include?: unknown; exclude?: unknown };
  return {
    include: stringList(config.include) ?? fallback.include,
    exclude: stringList(config.exclude) ?? fallback.exclude,
  };
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((v) => typeof v === "string") ? (value as string[]) : null;
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
  return [...found].sort();
}

// ── argv ────────────────────────────────────────────────────────────────────

/** Whether the caller already named the files to run, in which case we do not. */
function hasExplicitFiles(args: string[]): boolean {
  return args.some((arg) => !arg.startsWith("-"));
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
}): string[] {
  const [executable, ...args] = input.command;
  if (executable !== "tap") return input.command;

  // -j1 is what "carefully" means: the flakes in this tier are contention.
  const flags = input.tier === "careful" && !args.some((a) => a.startsWith("-j")) ? ["-j1"] : [];
  if (hasExplicitFiles(args)) return [executable, ...flags, ...args];

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
export function carefulExclusions(packageRoot: string = PACKAGE_ROOT): string[] {
  return readCarefulList(packageRoot).map((rel) => `callback-box/${rel}`);
}
