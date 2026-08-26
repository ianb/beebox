/**
 * The shape of the derived test->source import graph, and the pure questions
 * asked of it.
 *
 * Separate from the esbuild pass that produces it (test-graph.ts) because
 * these are the parts every consumer reasons about — the ledger's `implicated`
 * counterfactual, and later the selector's accounted/unaccounted rule — and
 * they should be testable without building anything.
 */

export interface TestGraph {
  /** repo-relative test entrypoint -> repo-relative files it transitively imports */
  tests: Map<string, Set<string>>;
  /** every repo file appearing anywhere in the graph */
  universe: Set<string>;
  /** entrypoints esbuild could not fully resolve — callers must always run these */
  unresolved: Set<string>;
  /** how many specifiers had more than one candidate (all were kept as edges) */
  ambiguousEdges: number;
  buildMs: number;
  /** true when this graph came from the content-keyed cache rather than esbuild */
  cached: boolean;
}

/**
 * The changed paths that could conceivably affect the callback-box suite.
 *
 * Everything else — `issues/`, `bin/`, `ios-app/`, `research/`, root docs — is
 * outside this suite's concern entirely and must not make a change look
 * unaccounted; `/finish` already routes those to their own verification
 * (`.claude/agents/finish.md:184-196`).
 *
 * Prose markdown inside the package is also out, and that one is load-bearing
 * rather than obvious: counting it drops the per-commit accounted rate from
 * 63% to 27%. It is safe because no doctest in the suite reads the
 * repository's own prose — real-doc validation is `doc-check`, a pre-commit
 * hook outside tap. A `.doctest.md` is of course a test, not prose.
 */
export function scopedChanges(changed: string[]): string[] {
  return changed.filter((path) => {
    const inScope =
      path.startsWith("callback-box/") ||
      path.startsWith("agent-doctest/") ||
      path === "package.json" ||
      path === "pnpm-lock.yaml" ||
      path === "pnpm-workspace.yaml";
    if (!inScope) return false;
    return !path.endsWith(".md") || path.endsWith(".doctest.md");
  });
}

/**
 * The tests the graph points at for a set of changed paths — every test that
 * imports one of them, plus any changed path that is itself a test.
 *
 * This is *only* the graph's opinion. It deliberately knows nothing about
 * policy: no `alwaysRun`, no unresolved fail-open, no escape to the full suite
 * when a changed path is unaccounted. Those belong to the selector. Keeping
 * the graph's answer separate is what lets the ledger record what the graph
 * alone would have caught, which is the counterfactual the whole instrument
 * exists to measure.
 */
export function implicatedTests(input: { graph: TestGraph; changed: string[] }): Set<string> {
  const { graph } = input;
  const changed = scopedChanges(input.changed);
  const changedSet = new Set(changed);
  const implicated = new Set<string>();
  for (const [entry, deps] of graph.tests) {
    if (changedSet.has(entry)) {
      implicated.add(entry);
      continue;
    }
    for (const path of changed) {
      if (deps.has(path)) {
        implicated.add(entry);
        break;
      }
    }
  }
  return implicated;
}

/**
 * Whether the graph can account for every changed path in scope — each is
 * either a test entrypoint or a file some test imports. A path it has never
 * seen (a config file, a template, an untested component) makes the whole
 * change unaccounted, and the selector's answer for an unaccounted change is
 * "run everything".
 */
export function isAccounted(input: { graph: TestGraph; changed: string[] }): boolean {
  const { graph, changed } = input;
  return scopedChanges(changed).every((path) => graph.tests.has(path) || graph.universe.has(path));
}
