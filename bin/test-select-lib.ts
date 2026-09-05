/**
 * Which tests a change calls for — the pure half.
 *
 *   selected = spawnEdges ∪ graph.unresolved ∪ changedTests ∪ implicated
 *
 * and nothing else. There is no escape to the full suite: an unaccounted
 * changed path contributes nothing, and an empty selection is the honest
 * statement that no test imports what changed. That inversion is the
 * 2026-08-25 revision of beebox/docs/plans/change-based-test-selection.md
 * (mechanism B), which replaced Track 2's `FULL` fallback after sixteen days of
 * ledger data found no case of a full run catching an unimplicated bug.
 *
 * Everything here is repo-relative, the graph's own vocabulary. The CLI
 * (test-select.ts) strips the package prefix at print time, because that is
 * what tap wants.
 */

import { implicatedTests, scopedChanges, type TestGraph } from "./test-graph-query.js";

export interface Selection {
  /** Repo-relative test entrypoints to run, sorted. */
  selected: string[];
  /** The graph's opinion alone — recorded by the ledger, never the whole answer. */
  implicated: string[];
  /** The changed paths that could affect this suite at all. */
  scoped: string[];
}

export function selectTests(input: {
  graph: TestGraph;
  changed: string[];
  /**
   * Spawner edges: test -> the source refs its CHILD process touches, from
   * {@link spawnerEdges}. Each ref is an extra edge, so a spawner is selected
   * only when the change matches one of them.
   */
  spawnEdges?: Map<string, Set<string>>;
  /**
   * The repo files bundled into `dist/cli.mjs` (test-graph.ts's
   * `cliBundleInputs`). Null/absent means unknown, and a `dist/cli.mjs` ref
   * then matches any `beebox/src/` change — fail open, since the bundle
   * is a superset of no-one-knows-what.
   */
  cliBundleInputs?: Set<string> | null;
  /**
   * Careful-tier files, which run in the batched exclusive run instead
   * (mechanism C). A changed test still runs: the exclusion is about not
   * paying for a flaky neighbour, not about skipping the test you just edited.
   */
  exclude?: Iterable<string>;
}): Selection {
  const { graph } = input;
  const scoped = scopedChanges(input.changed);
  const scopedSet = new Set(scoped);
  const implicated = implicatedTests({ graph, changed: input.changed });

  const changedTests = scoped.filter((path) => graph.tests.has(path) || graph.unresolved.has(path));
  // Spawner edges stand in for import edges the graph cannot see, and are read
  // exactly like them: a spawner runs when the change matches one of ITS refs,
  // not whenever anything in this suite's territory moved (plan revision
  // 2026-08-25, mechanism B — `alwaysRun` was a set, it is now edges).
  const spawners = matchedSpawners({
    edges: input.spawnEdges,
    scoped,
    cliBundleInputs: input.cliBundleInputs ?? null,
  });
  const selected = new Set<string>([
    ...spawners,
    ...graph.unresolved,
    ...changedTests,
    ...implicated,
  ]);
  for (const path of input.exclude ?? []) {
    if (!scopedSet.has(path)) selected.delete(path);
  }

  return {
    selected: [...selected].toSorted(),
    implicated: [...implicated].toSorted(),
    scoped,
  };
}

// ── spawner edges: the imports the graph cannot see ─────────────────────────

/**
 * A spawn of some kind. Track 3c: a test that runs source in a CHILD process
 * has no import edge to it, so no change to that source ever selects it —
 * `test/frontend/trpc-directory-resolution.test.ts` spawns twelve children
 * importing frontend source and is the regression test for the TSX loader
 * flake.
 */
const SPAWN_CALL = /\b(?:spawnSync|spawn|execFileSync|execFile|fork\()|\bexec\(/;

/** A string literal naming repo source, or the bundled CLI a test may exec. */
const SOURCE_LITERAL =
  /(["'`])([^\n"'`]*?(?:src\/[\w./-]+\.(?:ts|tsx|mjs|js|jsx)|dist\/cli\.mjs)[^\n"'`]*?)\1/g;

/**
 * An import/export statement's specifier is not a spawn argument.
 *
 * Dropping these lines before looking for literals is what keeps the heuristic
 * usable: without it, every ordinary import in a file that happens to spawn
 * something reads as a child's target, and the real suite produced 71
 * spawner entrypoints instead of 10. A type-only import is the sharp case —
 * it leaves no graph edge, so it looks exactly like an uncovered reference.
 */
const IMPORT_LINE = /^\s*(?:import|export)\b[^\n]*?(?:from\s*)?["'][^"']+["']/;

/** The build artifact a test execs instead of importing the CLI. */
const CLI_BUNDLE = "dist/cli.mjs";

/** Source paths a file appears to hand to a child process. */
export function spawnedSourceRefs(source: string): string[] {
  const body = source
    .split("\n")
    .filter((line) => !IMPORT_LINE.test(line))
    .join("\n");
  if (!SPAWN_CALL.test(body)) return [];
  return [...new Set([...body.matchAll(SOURCE_LITERAL)].map((match) => match[2] ?? ""))];
}

/**
 * Test -> the source refs its child processes touch that its own imports do
 * NOT cover. Each is an extra edge for {@link selectTests}, so a spawner is
 * selected by a change to what it spawns and by nothing else. (Until the
 * 2026-08-25 revision these were an `alwaysRun` SET, which cost ~10 files and
 * ~35s on every selected run whatever the change was.)
 *
 * An entrypoint contributes a ref when it — or a `test/helpers/**` module it
 * imports — hands a child process a path to repo source, or the built
 * `dist/cli.mjs` (a build artifact, in no graph, so a change to the sources it
 * bundles can never point at it).
 *
 * Helpers are read through the graph rather than globbed so a spawner is
 * attributed to the tests that actually use it. Refs are compared by path tail
 * without extension, because a NodeNext specifier says `.js` where the file on
 * disk says `.ts`.
 */
export function spawnerEdges(input: {
  graph: TestGraph;
  /** Reads a repo-relative path; null when it cannot be read. */
  readFile: (path: string) => string | null;
}): Map<string, Set<string>> {
  const edges = new Map<string, Set<string>>();
  for (const [entry, deps] of input.graph.tests) {
    const sources = [entry, ...[...deps].filter((dep) => dep.includes("/test/helpers/"))];
    const refs = new Set<string>();
    for (const path of sources) {
      const contents = input.readFile(path);
      if (contents === null) continue;
      for (const ref of spawnedSourceRefs(contents)) {
        if (!isCoveredByImports(ref, deps)) refs.add(ref);
      }
    }
    if (refs.size > 0) edges.set(entry, refs);
  }
  return edges;
}

/** The spawners whose refs one of the changed paths matches. */
function matchedSpawners(input: {
  edges: Map<string, Set<string>> | undefined;
  scoped: string[];
  cliBundleInputs: Set<string> | null;
}): string[] {
  const matched: string[] = [];
  for (const [entry, refs] of input.edges ?? []) {
    const hit = [...refs].some((ref) =>
      refMatchesChange({ ref, scoped: input.scoped, cliBundleInputs: input.cliBundleInputs }),
    );
    if (hit) matched.push(entry);
  }
  return matched;
}

/**
 * Whether a changed path is one of the sources bundled into `dist/cli.mjs`.
 *
 * `scripts/build-cli.ts` bundles `src/cli/index.ts` transitively, so the real
 * input set is most of `src/` — not `src/cli/**`, which would cover 100 of the
 * 932 files esbuild actually reads. The caller computes the true set; without
 * it we fail open on `src/`, the smallest honest superset.
 */
function isCliBundleInput(path: string, inputs: Set<string> | null): boolean {
  if (inputs === null) return path.startsWith("beebox/src/");
  return inputs.has(path);
}

export function refMatchesChange(input: {
  ref: string;
  scoped: string[];
  cliBundleInputs: Set<string> | null;
}): boolean {
  const { ref, scoped } = input;
  if (ref.includes(CLI_BUNDLE)) {
    return scoped.some((path) => isCliBundleInput(path, input.cliBundleInputs));
  }
  const tail = stripExtension(ref.replace(/^(?:\.\.?\/)+/, ""));
  if (tail === "") return false;
  return scoped.some((path) => stripExtension(path).endsWith(tail));
}

function isCoveredByImports(ref: string, deps: Set<string>): boolean {
  if (ref.includes(CLI_BUNDLE)) return false;
  const tail = stripExtension(ref.replace(/^(?:\.\.?\/)+/, ""));
  if (tail === "") return true;
  return [...deps].some((dep) => stripExtension(dep).endsWith(tail));
}

function stripExtension(path: string): string {
  return path.replace(/\.(?:ts|tsx|mjs|js|jsx)$/, "");
}
