/**
 * Which tests a change calls for — the pure half.
 *
 *   selected = alwaysRun ∪ graph.unresolved ∪ changedTests ∪ implicated
 *
 * and nothing else. There is no escape to the full suite: an unaccounted
 * changed path contributes nothing, and an empty selection is the honest
 * statement that no test imports what changed. That inversion is the
 * 2026-08-25 revision of callback-box/docs/plans/change-based-test-selection.md
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
  /** Entrypoints no import edge can reach — see {@link alwaysRunTests}. */
  alwaysRun?: Iterable<string>;
  /**
   * Careful-tier files, which run in the batched exclusive run instead
   * (mechanism C, not yet built). A changed test still runs: the exclusion is
   * about not paying for a flaky neighbour, not about skipping the test you
   * just edited.
   */
  exclude?: Iterable<string>;
}): Selection {
  const { graph } = input;
  const scoped = scopedChanges(input.changed);
  const scopedSet = new Set(scoped);
  const implicated = implicatedTests({ graph, changed: input.changed });

  const changedTests = scoped.filter((path) => graph.tests.has(path) || graph.unresolved.has(path));
  // `alwaysRun` compensates for edges the graph cannot see, so it fires
  // whenever this suite's territory changed at all — but not when nothing in
  // scope changed, which would make the empty selection unreachable and every
  // `test:changed` pay for ten files to verify a change to `bin/` or `issues/`.
  const alwaysRun = scoped.length === 0 ? [] : (input.alwaysRun ?? []);
  const selected = new Set<string>([
    ...alwaysRun,
    ...graph.unresolved,
    ...changedTests,
    ...implicated,
  ]);
  for (const path of input.exclude ?? []) {
    if (!scopedSet.has(path)) selected.delete(path);
  }

  return {
    selected: [...selected].sort(),
    implicated: [...implicated].sort(),
    scoped,
  };
}

// ── alwaysRun: the tests import edges cannot reach ──────────────────────────

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
  /(['"`])([^'"`\n]*?(?:src\/[A-Za-z0-9_./-]+\.(?:ts|tsx|mjs|js|jsx)|dist\/cli\.mjs)[^'"`\n]*?)\1/g;

/**
 * An import/export statement's specifier is not a spawn argument.
 *
 * Dropping these lines before looking for literals is what keeps the heuristic
 * usable: without it, every ordinary import in a file that happens to spawn
 * something reads as a child's target, and the real suite produced 71
 * always-run entrypoints instead of 10. A type-only import is the sharp case —
 * it leaves no graph edge, so it looks exactly like an uncovered reference.
 */
const IMPORT_LINE = /^\s*(?:import|export)\b[^\n]*?(?:from\s*)?['"][^'"]+['"]/;

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
 * The entrypoints that must run regardless of what the graph says.
 *
 * An entrypoint qualifies when it — or a `test/helpers/**` module it imports —
 * hands a child process a path to repo source that the entrypoint does NOT
 * import itself, or the built `dist/cli.mjs` (a build artifact, in no graph, so
 * a `src/cli/**` change can never point at it).
 *
 * Helpers are read through the graph rather than globbed so a spawner is
 * attributed to the tests that actually use it. Refs are compared by path tail
 * without extension, because a NodeNext specifier says `.js` where the file on
 * disk says `.ts`.
 */
export function alwaysRunTests(input: {
  graph: TestGraph;
  /** Reads a repo-relative path; null when it cannot be read. */
  readFile: (path: string) => string | null;
}): Set<string> {
  const alwaysRun = new Set<string>();
  for (const [entry, deps] of input.graph.tests) {
    const sources = [entry, ...[...deps].filter((dep) => dep.includes("/test/helpers/"))];
    const refs = new Set<string>();
    for (const path of sources) {
      const contents = input.readFile(path);
      if (contents === null) continue;
      for (const ref of spawnedSourceRefs(contents)) refs.add(ref);
    }
    if ([...refs].some((ref) => !isCoveredByImports(ref, deps))) alwaysRun.add(entry);
  }
  return alwaysRun;
}

function isCoveredByImports(ref: string, deps: Set<string>): boolean {
  if (ref.includes("dist/cli.mjs")) return false;
  const tail = stripExtension(ref.replace(/^(?:\.\.?\/)+/, ""));
  if (tail === "") return true;
  return [...deps].some((dep) => stripExtension(dep).endsWith(tail));
}

function stripExtension(path: string): string {
  return path.replace(/\.(?:ts|tsx|mjs|js|jsx)$/, "");
}
