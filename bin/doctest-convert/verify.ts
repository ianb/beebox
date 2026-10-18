/**
 * `verify <dir|file>...`: check converted files against their state entries
 * (plan retire-doctest.md, track 3). A file is verified when:
 *
 * - static fidelity holds: each example's marker appears once, and every
 *   check's method and expected value are as the converter wrote them;
 * - runtime fidelity holds: it passes, with the doctest's own tap
 *   assertion count (counts, not exit codes: a file that fails to load
 *   reports as one skipped test);
 * - eslint, run from its root's `lintFrom`, reports nothing;
 * - its root's typecheck program reports no error in it.
 *
 * Checks whose actual value changed are listed for the batch review.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compareChecks } from "./checks.ts";
import { byRoot, programsOf, runAll } from "./roots.ts";
import { loadAll, save, type FileState, type StateFile } from "./state.ts";
import { eslint, REPO, typecheck } from "./tools.ts";

const MAX_LINT_LINES = 20;

export interface Selected {
  doctest: string;
  state: StateFile;
  file: FileState;
}

/** State entries whose doctest or test file is, or is under, one of `paths`. */
export function select(paths: readonly string[]): Selected[] {
  const norm = paths.map((p) => p.replace(/\/$/, ""));
  const out: Selected[] = [];
  for (const state of loadAll().values()) {
    for (const [doctest, file] of Object.entries(state.files)) {
      if (norm.some((p) => [doctest, file.test].some((f) => f === p || f.startsWith(`${p}/`)))) out.push({ doctest, state, file });
    }
  }
  return out;
}

function runtimeProblems(file: FileState, got: { failures: number; assertions: number } | undefined): string[] {
  if (got === undefined) return ["did not run"];
  if (got.failures > 0) return [`${got.failures} failing`];
  const want = file.assertions ?? file.expectedAssertions;
  return got.assertions === want ? [] : [`${got.assertions} assertions, want ${want}`];
}

/** Verify the selected files; updates and saves their state entries. */
export function verify(selected: readonly Selected[]): void {
  const tests = selected.map((s) => s.file.test);
  const problems = new Map<string, string[]>(tests.map((t) => [t, []]));
  const add = (test: string, p: string): void => void problems.get(test)?.push(p);

  for (const s of selected) {
    const path = join(REPO, s.file.test);
    if (!existsSync(path)) {
      add(s.file.test, "the test file is missing");
      continue;
    }
    const report = compareChecks({
      before: s.file.checks,
      source: readFileSync(path, "utf8"),
      fileName: s.file.test,
      markerLines: s.file.examples.map((e) => e.line),
    });
    for (const p of report.problems) add(s.file.test, p);
    s.file.changedActuals = report.changedActuals;
  }

  const results = runAll(tests, {});
  for (const s of selected) for (const p of runtimeProblems(s.file, results.get(s.file.test))) add(s.file.test, `run: ${p}`);

  for (const [lintFrom, group] of byRoot(tests, (r) => r.lintFrom)) {
    for (const [file, messages] of eslint(lintFrom, group)) {
      const shown = messages.slice(0, MAX_LINT_LINES).map((m) => `lint: ${m.line ?? 0}: ${m.ruleId ?? "parse"}: ${m.message}`);
      const more = messages.length > MAX_LINT_LINES ? [`lint: ${messages.length - MAX_LINT_LINES} more findings`] : [];
      for (const p of [...shown, ...more]) add(file, p);
    }
  }

  // An error in a converted file outside the batch belongs to that file's
  // batch. Any other error fails the whole batch: a helper a worker added,
  // or a program that was already broken.
  const testSet = new Set(tests);
  const otherConverted = new Set([...loadAll().values()].flatMap((st) => Object.values(st.files).map((f) => f.test)));
  for (const program of programsOf(tests)) {
    const inProgram = tests.filter((t) => programsOf([t]).some((p) => p.dir === program.dir && p.script === program.script));
    for (const e of typecheck(program)) {
      if (testSet.has(e.file)) add(e.file, `typecheck: ${e.line}: ${e.code}: ${e.message}`);
      else if (!otherConverted.has(e.file)) for (const t of inProgram) add(t, `typecheck: ${program.dir} ${program.script} fails outside the batch: ${e.file}:${e.line}: ${e.code}`);
    }
  }

  const touched = new Set<StateFile>();
  for (const s of selected) {
    s.file.problems = problems.get(s.file.test) ?? [];
    if (s.file.problems.length === 0 && s.file.status === "converted") s.file.status = "verified";
    if (s.file.problems.length > 0 && s.file.status === "verified") s.file.status = "converted";
    touched.add(s.state);
  }
  for (const state of touched) save(state);
}
