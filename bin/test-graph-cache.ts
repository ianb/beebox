/**
 * Content-keyed cache for the derived test->source import graph.
 *
 * The esbuild pass over ~630 entrypoints costs ~2.5-3s, and `pnpm test:changed`
 * paid it on every iteration even when it selected nothing. The graph is a pure
 * function of the files it reads, so a key over those files' (path, mtime,
 * size) turns the warm case into a stat sweep — ~2,400 stats measure ~20ms.
 *
 * The cached graph's own `universe` supplies the file list to stat, which is
 * why the key can be recomputed before deciding to rebuild. Entrypoints are
 * re-globbed from `.taprc` every time and never read from the cache: a new test
 * file is invisible to a stat sweep over the old universe, but it does change
 * the entrypoint list, which is in the key both as stamps and as membership.
 *
 * A brand-new SOURCE file that nothing imports yet is likewise absent from the
 * universe, and that is correct: it cannot affect any test until something
 * imports it, and writing that import changes the importer's mtime.
 *
 * Deletions and moves are covered because an absent file stamps as a distinct
 * sentinel rather than being skipped. A stat that fails for any OTHER reason
 * poisons the whole key (null), because a permission or I/O error says the file
 * may have changed in a way we cannot see, and guessing there is how a stale
 * graph becomes permanent.
 *
 * ACCEPTED ESCAPES — two ways a hit can be stale, both left unfixed:
 *   1. A new resolution candidate outside the cached universe. Adding
 *      `foo.ts` beside an existing `foo/index.ts`, or creating the target of
 *      an import that previously resolved to nothing, changes edges without
 *      touching any file the key covers.
 *   2. A same-size edit landing inside one mtime tick of the stamped one.
 * Both are the plan's accepted-escape class (a selection can miss; the hourly
 * full run on `main` is what catches it), not correctness this cache owes.
 */

import { createHash } from "node:crypto";
import { globSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { TestGraph } from "./test-graph-query.js";

/** The parse boundary: a cache file or a package.json may hold anything. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((x) => typeof x === "string");
}

/** Where a cached graph lives — gitignored, per-worktree, disposable. */
export function defaultCacheDir(repoRoot: string): string {
  return join(repoRoot, "node_modules/.cache/test-graph");
}

/** This checkout, not the config's — a fixture's `repoRoot` is a temp dir. */
const BIN_DIR = import.meta.dirname;
const CHECKOUT_ROOT = resolve(BIN_DIR, "..");

/**
 * Sources whose change invalidates every graph: the builder itself, the
 * doctest transform and resolution rules it calls into, and the toolchain
 * those two are pinned to.
 */
function toolchainPaths(): string[] {
  return [
    join(BIN_DIR, "test-graph.ts"),
    join(BIN_DIR, "test-graph-cache.ts"),
    join(BIN_DIR, "test-graph-query.ts"),
    join(BIN_DIR, "test-tiers.ts"),
    join(CHECKOUT_ROOT, "agent-doctest/package.json"),
    join(CHECKOUT_ROOT, "node_modules/esbuild/package.json"),
    ...globSync("agent-doctest/src/**/*.ts", { cwd: CHECKOUT_ROOT }).map((rel) =>
      join(CHECKOUT_ROOT, rel),
    ),
  ];
}

/** esbuild's version, so a reinstall to a different one is a miss. */
function esbuildVersion(): string {
  try {
    const pkg: unknown = JSON.parse(
      readFileSync(join(CHECKOUT_ROOT, "node_modules/esbuild/package.json"), "utf-8"),
    );
    const version = isRecord(pkg) ? pkg.version : undefined;
    return typeof version === "string" ? version : "unknown";
  } catch (_e) {
    // The package.json is stamped as a file too, so an unreadable one still
    // moves the key when it changes.
    return "unreadable";
  }
}

/**
 * `tsconfig.json` and everything it extends.
 *
 * Read with a regex rather than a parser because tsconfigs are JSONC and this
 * only needs a path to stat — a miss here costs a rebuild, not correctness.
 * Bounded so a cyclic `extends` cannot spin.
 */
function tsconfigChain(packageRoot: string): string[] {
  const chain: string[] = [];
  let path = join(packageRoot, "tsconfig.json");
  for (let depth = 0; depth < 8 && !chain.includes(path); depth += 1) {
    chain.push(path);
    let text: string;
    try {
      text = readFileSync(path, "utf-8");
    } catch (_e) {
      // A tsconfig named by an `extends` that is not installed (or a chain that
      // walks off the tree). What cannot be read cannot be stamped; the chain
      // stops here rather than failing the run.
      break;
    }
    const target = /"extends"\s*:\s*"([^"]+)"/.exec(text)?.[1];
    if (target === undefined) break;
    const base: string = target.startsWith(".")
      ? resolve(dirname(path), target)
      : join(CHECKOUT_ROOT, "node_modules", target);
    path = base.endsWith(".json") ? base : `${base}.json`;
  }
  return chain;
}

export interface KeyInputs {
  repoRoot: string;
  packageRoot: string;
  aliases: Record<string, string>;
  /** absolute paths, re-globbed every run */
  entrypoints: string[];
  /** repo-relative, from the graph being keyed */
  universe: Iterable<string>;
}

/** Every path the key stamps, absolute and sorted. */
export function keyPaths(inputs: KeyInputs): string[] {
  const files = new Set<string>(toolchainPaths());
  files.add(join(inputs.packageRoot, ".taprc"));
  for (const path of tsconfigChain(inputs.packageRoot)) files.add(path);
  for (const entry of inputs.entrypoints) files.add(resolve(inputs.repoRoot, entry));
  for (const rel of inputs.universe) files.add(resolve(inputs.repoRoot, rel));
  return [...files].toSorted();
}

/**
 * `(mtime, size)` for each path, or null if any stat failed for a reason other
 * than the file not existing. Null means "cannot be keyed": no hit, no write.
 */
export function stampPaths(paths: string[]): Map<string, string> | null {
  const stamps = new Map<string, string>();
  for (const path of paths) {
    try {
      const s = statSync(path);
      stamps.set(path, `${s.mtimeMs} ${s.size}`);
    } catch (e) {
      const code = isRecord(e) && typeof e.code === "string" ? e.code : undefined;
      if (code !== "ENOENT" && code !== "ENOTDIR") return null;
      stamps.set(path, "absent");
    }
  }
  return stamps;
}

/**
 * sha256 over the stamped set plus the build's shape.
 *
 * The entrypoint LIST is hashed as data, not only through its members' stamps:
 * membership is what changes when a test file is added or removed, and a
 * removed file's stamp would otherwise just vanish from the set.
 */
export function keyOf(input: {
  aliases: Record<string, string>;
  entrypoints: string[];
  paths: string[];
  stamps: Map<string, string>;
}): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(input.aliases));
  hash.update(JSON.stringify(input.entrypoints.toSorted()));
  hash.update(esbuildVersion());
  for (const path of input.paths) hash.update(` ${path} ${input.stamps.get(path) ?? "?"}`);
  return hash.digest("hex");
}

/** Which cache file this config uses; entrypoints are deliberately not in it. */
export function cacheFile(input: {
  cacheDir: string;
  repoRoot: string;
  packageRoot: string;
  aliases: Record<string, string>;
}): string {
  const identity = createHash("sha256")
    .update(JSON.stringify([input.repoRoot, input.packageRoot, input.aliases]))
    .digest("hex")
    .slice(0, 16);
  return join(input.cacheDir, `${identity}.json`);
}

export interface StoredGraph {
  key: string;
  tests: Record<string, string[]>;
  universe: string[];
  unresolved: string[];
  ambiguousEdges: number;
  buildMs: number;
}

function isStoredGraph(value: unknown): value is StoredGraph {
  if (!isRecord(value)) return false;
  if (typeof value.key !== "string") return false;
  const tests = value.tests;
  if (!isRecord(tests)) return false;
  if (typeof value.ambiguousEdges !== "number" || typeof value.buildMs !== "number") return false;
  if (!isStringArray(value.universe) || !isStringArray(value.unresolved)) return false;
  return Object.values(tests).every(isStringArray);
}

/**
 * The stored graph, or null.
 *
 * Every failure — missing file, truncated write, a shape from an older version
 * — is a miss, never a throw: a cache that can break the build is worse than
 * no cache. Read even when caching is off, because its universe is what the
 * pre-build stamp of the mid-build-write guard covers.
 */
export function readStoredGraph(path: string): StoredGraph | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    return isStoredGraph(parsed) ? parsed : null;
  } catch (_e) {
    // Absorbs a cache file that is missing, or caught mid-rename by a
    // concurrent writer. Either way the answer is "no cached graph".
    return null;
  }
}

export function storedToGraph(stored: StoredGraph): TestGraph {
  return {
    tests: new Map(Object.entries(stored.tests).map(([entry, deps]) => [entry, new Set(deps)])),
    universe: new Set(stored.universe),
    unresolved: new Set(stored.unresolved),
    ambiguousEdges: stored.ambiguousEdges,
    buildMs: stored.buildMs,
    cached: true,
  };
}

/** Write the graph and its key. Failure is silent — the cache is an optimisation. */
export function writeCachedGraph(input: { path: string; key: string; graph: TestGraph }): void {
  const stored: StoredGraph = {
    key: input.key,
    tests: Object.fromEntries([...input.graph.tests].map(([e, deps]) => [e, [...deps]])),
    universe: [...input.graph.universe],
    unresolved: [...input.graph.unresolved],
    ambiguousEdges: input.graph.ambiguousEdges,
    buildMs: input.graph.buildMs,
  };
  try {
    mkdirSync(dirname(input.path), { recursive: true });
    // Rename so a concurrent reader never sees a half-written file.
    const temporary = `${input.path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(stored));
    renameSync(temporary, input.path);
  } catch (_e) {
    // A cache that cannot be written is a slow run, not a failed one.
  }
}

/** Paths that changed between two stamp sweeps of the same set. */
export function changedBetween(input: {
  paths: string[];
  before: Map<string, string>;
  after: Map<string, string>;
}): string[] {
  return input.paths.filter((path) => input.before.get(path) !== input.after.get(path));
}
