/**
 * Derive the test -> source import graph for callback-box, with esbuild.
 *
 *   node --import tsx bin/test-graph.ts                    # summary
 *   node --import tsx bin/test-graph.ts <file>             # which tests import <file>
 *   node --import tsx bin/test-graph.ts --no-cache         # ignore the cached graph
 *
 * The esbuild pass over ~630 entrypoints measures ~2.5s, so a successful build
 * is cached under a key over the mtime/size of every file it read (see
 * test-graph-cache.ts); `--no-cache` forces the build.
 *
 * Two load-bearing properties: ambiguity is ADDITIVE (every candidate becomes
 * an edge, because over-approximating costs a test run while under-
 * approximating loses one silently), and unresolvable is PER-TEST FAIL-OPEN
 * (one broken import marks its own entrypoints, never the whole suite).
 */

import { build, type Metafile, type BuildFailure, type Plugin, type PluginBuild } from "esbuild";
import { readFileSync } from "node:fs";
import { relative, resolve, dirname, join } from "node:path";
import { candidateFiles, isRelative } from "../agent-doctest/src/resolve-rules.ts";
import {
  cacheFile,
  changedBetween,
  defaultCacheDir,
  keyOf,
  keyPaths,
  readStoredGraph,
  stampPaths,
  storedToGraph,
  writeCachedGraph,
  type KeyInputs,
} from "./test-graph-cache.js";
import type { TestGraph } from "./test-graph-query.js";
import { taprcTestFiles } from "./test-tiers.js";

export const REPO_ROOT = resolve(import.meta.dirname, "..");
const PACKAGE_ROOT = join(REPO_ROOT, "callback-box");

/**
 * Everything the graph pass needs to know about the tree it is graphing.
 * Injected rather than hardcoded so the builder is testable against a fixture
 * tree — per engineering-principles #10, a thing that can only run against the
 * real 484-file repo is a thing whose edge cases never get tested.
 */
export interface GraphConfig {
  repoRoot: string;
  packageRoot: string;
  /** alias prefix -> absolute directory */
  aliases: Record<string, string>;
  /** absolute paths */
  entrypoints: string[];
}

/**
 * Exactly one alias, deliberately: `callback-box/tsconfig.json` maps only
 * `@shared/*`, and its comment says the frontend's other aliases "stay
 * unresolvable on purpose — a frontend module reaching for those in a doctest
 * is a boundary violation, not a config gap".
 */
const CALLBACK_BOX_ALIASES: Record<string, string> = {
  "@shared/": join(PACKAGE_ROOT, "src/shared"),
};

/** What `.taprc` includes, as absolute paths — the graph's entrypoints. */
export function testEntrypoints(packageRoot: string): string[] {
  return taprcTestFiles(packageRoot).map((rel) => join(packageRoot, rel));
}

export function callbackBoxConfig(): GraphConfig {
  return {
    repoRoot: REPO_ROOT,
    packageRoot: PACKAGE_ROOT,
    aliases: CALLBACK_BOX_ALIASES,
    entrypoints: testEntrypoints(PACKAGE_ROOT),
  };
}

interface GraphInternals {
  extraEdges: Map<string, Set<string>>;
  /** absolute paths of files with an import that resolved to nothing */
  brokenImporters: Set<string>;
  ambiguousEdges: number;
}

function doctestPlugin(generateTestSource: (md: string, path: string) => string): Plugin {
  return {
    name: "doctest",
    setup(builder: PluginBuild): void {
      builder.onResolve({ filter: /\.doctest\.md$/ }, (args: { path: string; importer: string }) => ({
        path: args.importer ? resolve(dirname(args.importer), args.path) : args.path,
        namespace: "file",
      }));
      builder.onLoad({ filter: /\.doctest\.md$/ }, (args: { path: string }) => {
        const markdown = readFileSync(args.path, "utf-8");
        try {
          return {
            contents: generateTestSource(markdown, args.path),
            loader: "ts",
            resolveDir: dirname(args.path),
          };
        } catch (e) {
          // A doctest that will not transform cannot be graphed. Surface it as
          // a build error so its entrypoint lands in `unresolved` and is
          // always run, rather than silently graphing as having no imports.
          return { errors: [{ text: `doctest transform failed: ${String(e)}` }] };
        }
      });
    },
  };
}

function resolutionPlugin(internals: GraphInternals, config: GraphConfig): Plugin {
  return {
    name: "tsx-resolution",
    setup(builder: PluginBuild): void {
      builder.onResolve({ filter: /^(\.\.?\/|@)/ }, (args: { path: string; importer: string }) => {
        // The filter has to admit `@` to catch alias prefixes, which also
        // catches scoped npm packages (`@tapjs/core`). Those are not ours:
        // hand them back so `packages: "external"` deals with them. Recording
        // them as broken would have marked 296 of 484 entrypoints unresolved.
        const isAliased = Object.keys(config.aliases).some((prefix) => args.path.startsWith(prefix));
        if (!isRelative(args.path) && !isAliased) return null;

        const importerDir = args.importer ? dirname(args.importer) : config.packageRoot;
        const candidates = candidateFiles(args.path, { importerDir, aliases: config.aliases });
        const first = candidates[0];
        if (first === undefined) {
          // Per-entrypoint fail-open. Letting esbuild error here would abort
          // the whole pass, dumping all 484 entrypoints into `unresolved` and
          // forcing the full suite for everyone over one typo. Marking it
          // external keeps the graph building; the importer is recorded so the
          // entrypoints that depend on it — and only those — fail open.
          //
          // Doing the bookkeeping here rather than parsing esbuild's log is
          // deliberate: its resolve errors carry an empty `id`, so
          // `logOverride` cannot target them and a text match would be brittle.
          internals.brokenImporters.add(args.importer);
          return { path: args.path, external: true };
        }
        if (candidates.length > 1) {
          internals.ambiguousEdges += candidates.length - 1;
          const extras = internals.extraEdges.get(args.importer) ?? new Set<string>();
          for (const extra of candidates.slice(1)) extras.add(extra);
          internals.extraEdges.set(args.importer, extras);
        }
        return { path: first };
      });
    },
  };
}

function isBuildFailure(e: unknown): e is BuildFailure {
  return typeof e === "object" && e !== null && "errors" in e;
}

/** The one thing this module needs from `agent-doctest`'s hooks module. */
interface DoctestHooks {
  generateTestSource: (md: string, path: string) => string;
}

function isDoctestHooks(module: unknown): module is DoctestHooks {
  if (typeof module !== "object" || module === null) return false;
  return "generateTestSource" in module && typeof module.generateTestSource === "function";
}

/** The doctest hooks module loaded, but without the transform the graph needs. */
class DoctestHooksUnavailableError extends Error {
  constructor(readonly path: string) {
    super(`no generateTestSource export in ${path}`);
    this.name = "DoctestHooksUnavailableError";
  }
}


export async function buildGraphFrom(config: GraphConfig): Promise<TestGraph> {
  const hooksPath = join(REPO_ROOT, "agent-doctest/src/doctest-hooks.ts");
  const hooks: unknown = await import(hooksPath);
  if (!isDoctestHooks(hooks)) throw new DoctestHooksUnavailableError(hooksPath);
  const { generateTestSource } = hooks;

  const entrypoints = config.entrypoints;
  const internals: GraphInternals = {
    extraEdges: new Map(),
    brokenImporters: new Set(),
    ambiguousEdges: 0,
  };
  const started = performance.now();

  let metafile: Metafile | undefined;
  let hardFailure = false;
  try {
    const result = await build({
      entryPoints: entrypoints,
      bundle: true,
      packages: "external",
      write: false,
      metafile: true,
      platform: "node",
      format: "esm",
      logLevel: "silent",
      outdir: join(config.repoRoot, ".test-graph-out"),
      outbase: config.packageRoot,
      absWorkingDir: config.packageRoot,
      jsx: "automatic",
      resolveExtensions: [".ts", ".tsx", ".mjs", ".js", ".jsx", ".json"],
      loader: { ".css": "empty", ".svg": "empty", ".png": "empty" },
      plugins: [doctestPlugin(generateTestSource), resolutionPlugin(internals, config)],
    });
    metafile = result.metafile;
  } catch (e) {
    if (!isBuildFailure(e)) throw e;
    // Something the plugin's fail-open did not cover (a doctest that will not
    // transform, say). No metafile means no graph, so every entrypoint is
    // unresolved and every caller runs everything. The safe direction.
    hardFailure = true;
    metafile = undefined;
  }

  const buildMs = performance.now() - started;
  const toRepoRel = (p: string): string =>
    relative(config.repoRoot, resolve(config.packageRoot, p));

  const tests = new Map<string, Set<string>>();
  const universe = new Set<string>();
  if (metafile !== undefined) {
    for (const output of Object.values(metafile.outputs)) {
      if (output.entryPoint === undefined) continue;
      const deps = new Set<string>();
      for (const input of Object.keys(output.inputs)) {
        if (input.includes("node_modules")) continue;
        const rel = toRepoRel(input);
        if (rel.startsWith("..")) continue;
        deps.add(rel);
        universe.add(rel);
      }
      tests.set(toRepoRel(output.entryPoint), deps);
    }
  }

  // Fold ambiguity extras into the DEPS of every test that reaches the
  // importer — not just into `universe`.
  //
  // Adding them to `universe` alone produces the worst possible combination:
  // `isAccounted` says yes (the path is known), so selection proceeds, while
  // `implicatedTests` finds no test (no deps set contains it), so it selects
  // nothing. A change to that file would then run almost nothing while looking
  // fully understood. Ambiguity has to be additive where implication reads it.
  for (const [importerAbs, extras] of internals.extraEdges) {
    const importer = toRepoRel(importerAbs);
    const relExtras = [...extras].map(toRepoRel).filter((rel) => !rel.startsWith(".."));
    if (relExtras.length === 0) continue;
    for (const rel of relExtras) universe.add(rel);
    for (const deps of tests.values()) {
      if (!deps.has(importer)) continue;
      for (const rel of relExtras) deps.add(rel);
    }
  }

  // An entrypoint is unresolved when it produced no output at all, or when it
  // (transitively) imports a file esbuild could not resolve — in that second
  // case the graph exists but is missing an edge, which is exactly the
  // condition callers must fail open on.
  const unresolved = new Set<string>();
  for (const entry of entrypoints) {
    const rel = toRepoRel(entry);
    if (!tests.has(rel)) {
      unresolved.add(rel);
      continue;
    }
    if (hardFailure) {
      unresolved.add(rel);
      continue;
    }
    const deps = tests.get(rel);
    if (deps === undefined) continue;
    for (const brokenAbs of internals.brokenImporters) {
      const broken = toRepoRel(brokenAbs);
      if (rel === broken || deps.has(broken)) {
        unresolved.add(rel);
        break;
      }
    }
  }

  return {
    tests,
    universe,
    unresolved,
    ambiguousEdges: internals.ambiguousEdges,
    buildMs,
    cached: false,
  };
}

export interface CacheOptions {
  /** default true; false forces the esbuild pass and still refreshes the cache */
  cache?: boolean;
  /** default `<repoRoot>/node_modules/.cache/test-graph` */
  cacheDir?: string;
}

/**
 * The graph for `config`, from the cache when its key still holds.
 *
 * The key is recomputed from the CACHED graph's universe, which is what lets
 * the decision be made before building anything. Entrypoints are re-globbed
 * from `.taprc` on every call, never cached — see test-graph-cache.ts for why
 * that closes the new-file gap.
 */
export async function buildGraphCached(
  config: GraphConfig,
  options?: CacheOptions,
): Promise<TestGraph> {
  const cacheDir = options?.cacheDir ?? defaultCacheDir(config.repoRoot);
  const path = cacheFile({
    cacheDir,
    repoRoot: config.repoRoot,
    packageRoot: config.packageRoot,
    aliases: config.aliases,
  });
  const inputsFor = (universe: Iterable<string>): KeyInputs => ({ ...config, universe });
  const keyWith = (paths: string[], stamps: Map<string, string>): string =>
    keyOf({ aliases: config.aliases, entrypoints: config.entrypoints, paths, stamps });

  // Read even when caching is off: the stored universe is what the pre-build
  // stamp below can cover, and a rebuild should still leave a sound cache.
  const stored = readStoredGraph(path);

  if (options?.cache !== false && stored !== null) {
    const paths = keyPaths(inputsFor(stored.universe));
    const stamps = stampPaths(paths);
    if (stamps !== null && keyWith(paths, stamps) === stored.key) return storedToGraph(stored);
  }

  // Guard against a file saved DURING the build. The key is necessarily
  // computed afterwards, so a mid-build write would be stored as the stamp of
  // edges that predate it — a hit that stays stale until something else moves.
  // Stamping the known keyed set first and refusing to write when any of it
  // moved costs one extra sweep and makes that impossible. What no cache
  // exists for (a first run's universe) cannot be covered; the next run's
  // rebuild is the recourse.
  const beforePaths = keyPaths(inputsFor(stored?.universe ?? []));
  const beforeStamps = stampPaths(beforePaths);

  const graph = await buildGraphFrom(config);

  // A build that produced nothing is a hard failure, not a graph. Its universe
  // is empty, so its key would depend on almost nothing and it would stick
  // around long after the cause was fixed.
  if (graph.tests.size === 0 && config.entrypoints.length > 0) return graph;

  const afterPaths = keyPaths(inputsFor(graph.universe));
  const afterStamps = stampPaths([...new Set([...beforePaths, ...afterPaths])].toSorted());
  if (beforeStamps === null || afterStamps === null) return graph;
  const moved = changedBetween({ paths: beforePaths, before: beforeStamps, after: afterStamps });
  if (moved.length > 0) return graph;

  writeCachedGraph({ path, key: keyWith(afterPaths, afterStamps), graph });
  return graph;
}

/** The callback-box graph. */
export async function buildGraph(options?: CacheOptions): Promise<TestGraph> {
  return buildGraphCached(callbackBoxConfig(), options);
}

/**
 * The repo files esbuild bundles into `callback-box/dist/cli.mjs`.
 *
 * A test that execs the bundle has no import edge to anything in it, and the
 * bundle is not `src/cli/**`: `scripts/build-cli.ts` bundles `src/cli/index.ts`
 * transitively, which reads 932 files across nearly every `src/` subtree. The
 * selector needs the real set to decide whether a change reaches such a test
 * (plan revision 2026-08-25, mechanism B). Mirrors that script's build options;
 * ~100ms.
 */
export async function cliBundleInputs(): Promise<Set<string>> {
  const result = await build({
    entryPoints: [join(PACKAGE_ROOT, "src/cli/index.ts")],
    bundle: true,
    packages: "external",
    write: false,
    metafile: true,
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "silent",
    absWorkingDir: REPO_ROOT,
  });
  const inputs = new Set<string>();
  for (const input of Object.keys(result.metafile.inputs)) {
    if (input.includes("node_modules")) continue;
    const rel = relative(REPO_ROOT, resolve(REPO_ROOT, input));
    if (!rel.startsWith("..")) inputs.add(rel);
  }
  return inputs;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cache = !argv.includes("--no-cache");
  const target = argv.find((a) => !a.startsWith("-"));
  const graph = await buildGraph({ cache });

  if (target !== undefined) {
    const needle = relative(REPO_ROOT, resolve(process.cwd(), target));
    const importers = [...graph.tests]
      .filter(([, deps]) => deps.has(needle))
      .map(([test]) => test)
      .toSorted();
    if (importers.length === 0) {
      console.log(`no test imports ${needle}`);
      console.log(
        graph.universe.has(needle)
          ? "(it is in the graph, but only as a leaf)"
          : "(it is not in the graph at all)",
      );
      return;
    }
    for (const importer of importers) console.log(importer);
    return;
  }

  console.log(`entrypoints:  ${graph.tests.size} graphed, ${graph.unresolved.size} unresolved`);
  console.log(`universe:     ${graph.universe.size} repo files`);
  console.log(`ambiguous:    ${graph.ambiguousEdges} extra edges`);
  console.log(
    `build:        ${(graph.buildMs / 1000).toFixed(2)}s${graph.cached ? " (cached)" : ""}`,
  );
}

if (process.argv[1] === import.meta.filename) {
  await main();
}
