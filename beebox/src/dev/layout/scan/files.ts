/**
 * File listing and classification for the scanner: everything that only
 * needs `git ls-files` and a path, no parsing.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirOf, isWithin } from "../graph.js";

const execFileAsync = promisify(execFile);

export type FileKind = "declaration" | "test" | "module" | "data";

const TYPESCRIPT_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];
const PLAIN_JS_EXTENSIONS = [".js", ".mjs", ".cjs"];
const TEST_SUFFIXES = [".doctest.md", ".test.ts", ".tour.ts"];

/** A TypeScript source file, `.d.ts` excluded. */
function isTypeScriptFile(path: string): boolean {
  return !path.endsWith(".d.ts") && TYPESCRIPT_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/**
 * `.d.ts` -> declaration; doctest/test/tour -> test; a TypeScript extension ->
 * module; a plain `.js`/`.mjs`/`.cjs` -> module only when `isSourceRoot` says
 * the file sits in `src/` or a source root (a top-level directory holding
 * TypeScript); such a file elsewhere is a static asset (data), e.g. the
 * frontend's `public/sw.js`.
 */
export function classifyFile(path: string, isSourceRoot: boolean): FileKind {
  if (path.endsWith(".d.ts")) return "declaration";
  if (TEST_SUFFIXES.some((suffix) => path.endsWith(suffix))) return "test";
  if (isTypeScriptFile(path)) return "module";
  if (PLAIN_JS_EXTENSIONS.some((ext) => path.endsWith(ext))) return isSourceRoot ? "module" : "data";
  return "data";
}

async function gitListFiles(params: { repoRoot: string; packageRoot: string }): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", params.packageRoot],
    { cwd: params.repoRoot, maxBuffer: 64 * 1024 * 1024 },
  );
  return stdout.split("\0").filter((path) => path.length > 0);
}

/** Directories that directly contain a `package.json`, strictly below `packageRoot`, minimal set only. */
function findNestedPackageRoots(params: { packageRoot: string; files: string[] }): string[] {
  const candidates = new Set<string>();
  for (const path of params.files) {
    if (!path.endsWith("/package.json")) continue;
    const dir = dirOf(path);
    if (dir !== params.packageRoot && isWithin(dir, params.packageRoot)) candidates.add(dir);
  }
  const sorted = [...candidates].toSorted((a, b) => a.length - b.length);
  const minimal: string[] = [];
  for (const dir of sorted) {
    if (minimal.some((existing) => isWithin(dir, existing))) continue;
    minimal.push(dir);
  }
  return minimal.toSorted();
}

/** Every ancestor directory of `path`, from `packageRoot` down, `path` excluded. */
function ancestorsOf(params: { path: string; packageRoot: string }): string[] {
  const segments = params.path.split("/");
  const dirs: string[] = [];
  for (let i = 1; i < segments.length; i++) {
    const dir = segments.slice(0, i).join("/");
    if (isWithin(dir, params.packageRoot)) dirs.push(dir);
  }
  return dirs;
}

const RESERVED_TOP_DIRS = new Set(["src", "test", "node_modules", "dist"]);

/**
 * Top-level package directories other than src/test/node_modules/dist/dot-dirs
 * holding at least one TypeScript file. Presence is decided by TypeScript
 * alone, not by `classifyFile` (which needs this result to classify plain
 * JavaScript in the first place).
 */
function findExtraSourceRoots(params: { packageRoot: string; files: string[] }): string[] {
  const withTypeScript = new Set<string>();
  for (const path of params.files) {
    if (!isTypeScriptFile(path)) continue;
    const rest = path.slice(params.packageRoot.length + 1);
    const slash = rest.indexOf("/");
    if (slash === -1) continue;
    const top = rest.slice(0, slash);
    if (RESERVED_TOP_DIRS.has(top) || top.startsWith(".")) continue;
    withTypeScript.add(`${params.packageRoot}/${top}`);
  }
  return [...withTypeScript].toSorted();
}

export interface ScannedFiles {
  /** Repo-relative paths under `packageRoot`, nested packages excluded. */
  files: string[];
  nestedPackages: string[];
  directories: Set<string>;
  extraSourceRoots: string[];
}

export async function listPackageFiles(params: { repoRoot: string; packageRoot: string }): Promise<ScannedFiles> {
  const rawFiles = await gitListFiles(params);
  const nestedPackages = findNestedPackageRoots({ packageRoot: params.packageRoot, files: rawFiles });
  const files = rawFiles
    .filter((path) => !nestedPackages.some((nested) => isWithin(path, nested)))
    .toSorted();

  const directories = new Set<string>([params.packageRoot]);
  for (const path of files) {
    for (const dir of ancestorsOf({ path, packageRoot: params.packageRoot })) directories.add(dir);
  }

  const extraSourceRoots = findExtraSourceRoots({ packageRoot: params.packageRoot, files });

  return { files, nestedPackages, directories, extraSourceRoots };
}
