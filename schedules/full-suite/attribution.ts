import type { TestGraph } from "../../bin/test-graph-query.js";
import { scopedChanges } from "../../bin/test-graph-query.js";
import { selectTests } from "../../bin/test-select-lib.js";
import type { Landing } from "./lib.js";

export interface Batch {
  pinned: string;
  base: string | null;
  landings: Landing[];
}

/**
 * Whether a landing's changed files can reach a failing test at all, by the
 * same rule change-based selection trusts: the import graph, plus spawner
 * edges for source a test hands to a child process, plus the CLI bundle's
 * input set. A landing that cannot reach the file cannot have broken it, and
 * blaming it anyway is how a `bin/`-only landing got an `important` issue for
 * a `src/core` watcher test (issues/bugs/2026-08-31-full-suite-red-*): under
 * host load the bisect's per-step verdicts are noise, and the search converges
 * on whichever landing is first in the window.
 *
 * Fail-open cases are inherited from `selectTests` deliberately: an entrypoint
 * the graph could not resolve is reachable by any in-scope change, and a
 * `dist/cli.mjs` spawner with no bundle-input set matches any `src/` change.
 * A landing with NO in-scope changes at all reaches nothing — `selectTests`
 * would still name the unresolved entrypoints, but a change the suite cannot
 * see cannot be the cause of any failure in it.
 */
export function landingReachesFile(input: {
  graph: TestGraph;
  spawnEdges: Map<string, Set<string>>;
  cliBundleInputs: Set<string> | null;
  changed: string[];
  file: string;
}): boolean {
  if (scopedChanges(input.changed).length === 0) return false;
  const selection = selectTests({
    graph: input.graph,
    changed: input.changed,
    spawnEdges: input.spawnEdges,
    cliBundleInputs: input.cliBundleInputs,
  });
  return selection.selected.includes(`beebox/${input.file}`);
}

/** Real failures that were not selected for bisect remain visible in the alert. */
export function unbisectedFiles(input: { real: readonly string[]; bisectable: readonly string[] }): string[] {
  const bisectable = new Set(input.bisectable);
  return input.real.filter((file) => !bisectable.has(file));
}
