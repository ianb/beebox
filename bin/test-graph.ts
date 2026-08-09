/**
 * Derive the test -> source import graph for callback-box, with esbuild.
 *
 *   node --import tsx bin/test-graph.ts                    # summary
 *   node --import tsx bin/test-graph.ts <file>             # which tests import <file>
 *
 * The graph is derived from the working tree on every call — there is no
 * cache and nothing to go stale. A full pass over ~484 entrypoints measured
 * 1.8s (see issues/exploration/2026-08-08-run-less-of-the-test-suite.md,
 * `## Track 0 measurement`), which is cheap enough that caching would be
 * machinery defending nothing.
 *
 * Two properties are deliberate and load-bearing:
 *
 *  - Ambiguity is ADDITIVE. When a specifier could resolve to more than one
 *    file, every candidate becomes an edge. Over-approximating costs extra
 *    test runs; under-approximating silently loses a test.
 *  - Unresolvable is PER-TEST FAIL-OPEN. An entrypoint esbuild cannot fully
 *    resolve is marked `unresolved` and callers must always run it. The build
 *    does not fail, so one broken import cannot disable selection wholesale.
 */

import { build, type Metafile, type BuildFailure } from "esbuild";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { relative, resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { candidateFiles, isRelative } from "../agent-doctest/src/resolve-rules.mjs";
import type { TestGraph } from "./test-graph-query.js";

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

/** Mirrors `callback-box/.taprc`'s include/exclude. */
export function testEntrypoints(packageRoot: string): string[] {
  const found: string[] = [];
  for (const pattern of ["test/**/*.doctest.md", "test/**/*.test.ts"]) {
    for (const rel of globSync(pattern, { cwd: packageRoot })) {
      if (rel.startsWith(`test/manual/`)) continue;
      found.push(join(packageRoot, rel));
    }
  }
  return found.sort();
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

function doctestPlugin(generateTestSource: (md: string, path: string) => string) {
  return {
    name: "doctest",
    setup(builder: { onResolve: Function; onLoad: Function }): void {
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

function resolutionPlugin(internals: GraphInternals, config: GraphConfig) {
  return {
    name: "tsx-resolution",
    setup(builder: { onResolve: Function }): void {
      builder.onResolve({ filter: /^(\.\.?\/|@)/ }, (args: { path: string; importer: string }) => {
        // The filter has to admit `@` to catch alias prefixes, which also
        // catches scoped npm packages (`@tapjs/core`). Those are not ours:
        // hand them back so `packages: "external"` deals with them. Recording
        // them as broken would have marked 296 of 484 entrypoints unresolved.
        const isAliased = Object.keys(config.aliases).some((prefix) => args.path.startsWith(prefix));
        if (!isRelative(args.path) && !isAliased) return null;

        const importerDir = args.importer ? dirname(args.importer) : config.packageRoot;
        const candidates = candidateFiles(args.path, { importerDir, aliases: config.aliases });
        if (candidates.length === 0) {
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
        return { path: candidates[0] };
      });
    },
  };
}

function isBuildFailure(e: unknown): e is BuildFailure {
  return typeof e === "object" && e !== null && "errors" in e;
}


export async function buildGraphFrom(config: GraphConfig): Promise<TestGraph> {
  const { generateTestSource } = (await import(
    join(REPO_ROOT, "agent-doctest/src/doctest-hooks.mjs")
  )) as { generateTestSource: (md: string, path: string) => string };

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

  for (const extras of internals.extraEdges.values()) {
    for (const extra of extras) {
      const rel = toRepoRel(extra);
      if (!rel.startsWith("..")) universe.add(rel);
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

  return { tests, universe, unresolved, ambiguousEdges: internals.ambiguousEdges, buildMs };
}

/** The callback-box graph. */
export async function buildGraph(): Promise<TestGraph> {
  return buildGraphFrom(callbackBoxConfig());
}

async function main(): Promise<void> {
  const target = process.argv[2];
  const graph = await buildGraph();

  if (target !== undefined) {
    const needle = relative(REPO_ROOT, resolve(process.cwd(), target));
    const importers = [...graph.tests]
      .filter(([, deps]) => deps.has(needle))
      .map(([test]) => test)
      .sort();
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
  console.log(`build:        ${(graph.buildMs / 1000).toFixed(2)}s`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
