/** Grouping files by the test root that runs, lints, and typechecks them (`bin/test-roots.ts`). */

import { rootOf, type TestRoot } from "../test-roots.ts";
import { NoTestRootError } from "./errors.ts";
import { tap, type TapResult } from "./tools.ts";

export function rootFor(file: string): TestRoot {
  const root = rootOf(file);
  if (root === null) throw new NoTestRootError(file);
  return root;
}

/** Files grouped by a key of their test root. */
export function byRoot<K>(files: readonly string[], key: (root: TestRoot) => K): Map<K, string[]> {
  const out = new Map<K, string[]>();
  for (const f of files) {
    const k = key(rootFor(f));
    const list = out.get(k) ?? [];
    list.push(f);
    out.set(k, list);
  }
  return out;
}

/** Each distinct typecheck program, once. */
export function programsOf(files: readonly string[]): { dir: string; script: string }[] {
  const seen = new Map<string, { dir: string; script: string }>();
  for (const f of files) {
    const { typecheck: p } = rootFor(f);
    seen.set(`${p.dir}\0${p.script}`, p);
  }
  return [...seen.values()];
}

/** Run files under their roots' tap configs, merged into one map. */
export function runAll(files: readonly string[], opts: { nodeArgs?: readonly string[]; env?: Record<string, string> }): Map<string, TapResult> {
  const out = new Map<string, TapResult>();
  for (const [runFrom, group] of byRoot(files, (r) => r.runFrom)) {
    for (const [k, v] of tap({ runFrom, files: group, ...opts })) out.set(k, v);
  }
  return out;
}
