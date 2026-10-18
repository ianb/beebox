/**
 * `prepare <dir>`: convert a directory's doctests to `.test.ts` files with
 * typed checks, record each conversion in the state file, and delete the
 * doctests. The loop is the one TRIALS.md section 1 measured over all files:
 *
 * 1. Run each doctest as it is: its tap assertion count is the baseline the
 *    converted file must match.
 * 2. Convert with differential probes and run them: a check whose typed form
 *    fails on the real value stays text; a promise value is awaited.
 * 3. Convert; typecheck; a type error inside a typed check keeps that check
 *    as text. Repeat until typecheck adds nothing.
 * 4. Lint; a `check-whole-value` finding on a typed check keeps it as text
 *    for phase 3 to strengthen.
 * 5. Apply eslint's layout fixes (quotes, spacing), which workers would
 *    otherwise make by hand.
 */

import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { z } from "zod";
import { checkSpans, checksByMarker } from "./checks.ts";
import { byRoot, programsOf, runAll } from "./roots.ts";
import { find, loadAll, save, type FileState, type StateFile } from "./state.ts";
import { blobOf, convert, doctestsUnder, eslint, eslintLayoutFix, isCommitted, REPO, typecheck } from "./tools.ts";

const TYPECHECK_ROUNDS = 6;
const LINT_ROUNDS = 3;

const ManifestSchema = z.object({
  doctest: z.string(),
  examples: z.array(
    z.object({
      line: z.number(),
      kind: z.enum(["check", "throws", "statement"]),
      typed: z.string().optional(),
      textReason: z.string().optional(),
    }),
  ),
});
type Manifest = z.infer<typeof ManifestSchema>;

const DifferentialRecord = z.object({ where: z.string(), typedPass: z.boolean(), isPromise: z.boolean() });

function testOf(doctest: string): string {
  return doctest.replace(/\.doctest\.md$/, ".test.ts");
}

interface Work {
  doctests: string[];
  textOnly: Map<string, Map<number, string>>;
  awaited: Map<string, Set<number>>;
  tmp: string;
}

function writeOptions(w: Work): string[] {
  const to = join(w.tmp, "text-only.json");
  const aw = join(w.tmp, "awaited.json");
  writeFileSync(to, JSON.stringify(Object.fromEntries([...w.textOnly].map(([d, m]) => [d, Object.fromEntries(m)]))));
  writeFileSync(aw, JSON.stringify(Object.fromEntries([...w.awaited].map(([d, s]) => [d, [...s]]))));
  // A manifest left from an earlier round must not stand in for this one's.
  rmSync(join(w.tmp, "manifests"), { recursive: true, force: true });
  return ["--upgrade", "--text-only", to, "--awaited", aw, "--manifest-dir", join(w.tmp, "manifests")];
}

function manifestOf(w: Work, doctest: string): Manifest | null {
  const path = join(w.tmp, "manifests", `${doctest}.json`);
  if (!existsSync(path)) return null;
  return ManifestSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * Keep as text the typed check whose call covers `line` of a converted file.
 * Returns whether it was newly kept.
 */
function keepText(w: Work, at: { test: string; line: number; reason: string }): boolean {
  const doctest = w.doctests.find((d) => testOf(d) === at.test);
  if (doctest === undefined) return false;
  const span = checkSpans(readFileSync(join(REPO, at.test), "utf8"), at.test).find((s) => s.start <= at.line && at.line <= s.end);
  if (span === undefined) return false;
  const entry = manifestOf(w, doctest)?.examples.find((e) => e.line === span.marker);
  const kept = w.textOnly.get(doctest) ?? new Map<number, string>();
  if (entry?.typed === undefined || entry.textReason !== undefined || kept.has(span.marker)) return false;
  kept.set(span.marker, at.reason);
  w.textOnly.set(doctest, kept);
  return true;
}

function differential(w: Work): void {
  const out = join(w.tmp, "differential.jsonl");
  convert(w.doctests, ["--upgrade", "--differential"]);
  runAll(w.doctests.map(testOf), {
    // tsx first: tap puts command-line node args ahead of .taprc's.
    nodeArgs: ["--import=tsx", `--import=${join(REPO, "bin/doctest-convert/differential.ts")}`],
    env: { DOCTEST_DIFFERENTIAL_OUT: out },
  });
  if (!existsSync(out)) return;
  for (const line of readFileSync(out, "utf8").split("\n")) {
    if (line === "") continue;
    const r = DifferentialRecord.parse(JSON.parse(line));
    const at = r.where.lastIndexOf(":");
    const doctest = relative(REPO, r.where.slice(0, at));
    const n = Number(r.where.slice(at + 1));
    if (!r.typedPass) {
      const kept = w.textOnly.get(doctest) ?? new Map<number, string>();
      kept.set(n, "typed check failed on the run's value");
      w.textOnly.set(doctest, kept);
    }
    if (r.isPromise) w.awaited.set(doctest, (w.awaited.get(doctest) ?? new Set()).add(n));
  }
}

function typecheckLoop(w: Work, log: (s: string) => void): void {
  const tests = new Set(w.doctests.map(testOf));
  for (let round = 0; round < TYPECHECK_ROUNDS; round++) {
    convert(w.doctests, writeOptions(w));
    let added = 0;
    for (const program of programsOf([...tests])) {
      for (const e of typecheck(program)) {
        if (tests.has(e.file) && keepText(w, { test: e.file, line: e.line, reason: `type error ${e.code}` })) added++;
      }
    }
    log(`  typecheck round ${round}: ${added} checks kept as text`);
    if (added === 0) return;
  }
}

function lintLoop(w: Work, log: (s: string) => void): void {
  const tests = w.doctests.map(testOf);
  for (let round = 0; round < LINT_ROUNDS; round++) {
    let added = 0;
    for (const [lintFrom, group] of byRoot(tests, (r) => r.lintFrom)) {
      for (const [file, messages] of eslint(lintFrom, group)) {
        for (const m of messages) {
          if (m.ruleId !== "agent-doctest/check-whole-value" || m.line === undefined) continue;
          if (keepText(w, { test: file, line: m.line, reason: "lossy actual value (strengthen in phase 3)" })) added++;
        }
      }
    }
    log(`  lint round ${round}: ${added} checks kept as text`);
    if (added === 0) return;
    convert(w.doctests, writeOptions(w));
  }
}

function testsIn(source: string): number {
  return [...source.matchAll(/^void (?:test|tapTest\d*)\(/gm)].length;
}

/** Convert the doctests under `dir` that have no conversion, or whose source changed since. */
export function prepare(dir: string, log: (s: string) => void): StateFile {
  const all = loadAll();
  const changed = doctestsUnder(dir).filter((d) => find(all, d)?.file.blob !== blobOf(d));
  const skip = new Map<string, string>();
  for (const d of changed) {
    // A test file the driver did not record is someone's own, or a stopped
    // run's output: never overwrite it.
    if (find(all, d) === null && existsSync(join(REPO, testOf(d)))) skip.set(d, `${testOf(d)} already exists; merge the two by hand, or delete it if a stopped run wrote it`);
    // The state records the doctest's blob; only a committed one is in history.
    else if (!isCommitted(d)) skip.set(d, "it has uncommitted changes; commit them first");
  }
  for (const [d, why] of skip) log(`${d}: skipped, ${why}`);
  const doctests = changed.filter((d) => !skip.has(d));
  const state: StateFile = all.get(dir.replace(/\/$/, "")) ?? { dir: dir.replace(/\/$/, ""), files: {} };
  if (doctests.length === 0) {
    log(`${dir}: nothing to convert`);
    return state;
  }
  const w: Work = { doctests, textOnly: new Map(), awaited: new Map(), tmp: mkdtempSync(join(tmpdir(), "doctest-convert-")) };
  try {
    log(`${dir}: ${doctests.length} doctests`);
    log("1. run the doctests for their baseline");
    const baseline = runAll(doctests, {});
    log("2. differential run");
    differential(w);
    log("3. convert and typecheck");
    typecheckLoop(w, log);
    log("4. lint");
    lintLoop(w, log);
    const failed = convert(doctests, writeOptions(w));
    for (const f of failed) log(`  ${f}`);
    log("5. layout fixes");
    for (const [lintFrom, group] of byRoot(doctests.map(testOf), (r) => r.lintFrom)) eslintLayoutFix(lintFrom, group);
    for (const doctest of doctests) {
      const manifest = manifestOf(w, doctest);
      const test = testOf(doctest);
      if (manifest === null || failed.some((f) => f.startsWith(`FAIL ${doctest}:`))) continue;
      const source = readFileSync(join(REPO, test), "utf8");
      const before = baseline.get(doctest);
      const entry: FileState = {
        test,
        blob: blobOf(doctest),
        status: "converted",
        examples: manifest.examples.map((e) => ({ line: e.line, kind: e.kind })),
        textOnly: Object.fromEntries([...(w.textOnly.get(doctest) ?? new Map<number, string>())].map(([l, r]) => [String(l), r])),
        awaited: [...(w.awaited.get(doctest) ?? [])].toSorted((a, b) => a - b),
        checks: checksByMarker(source, test),
        assertions: before !== undefined && before.failures === 0 ? before.assertions : null,
        expectedAssertions: manifest.examples.filter((e) => e.kind !== "statement").length + testsIn(source),
        problems: before === undefined ? ["the doctest did not run before conversion"] : before.failures > 0 ? [`the doctest had ${before.failures} failures before conversion`] : [],
        changedActuals: [],
      };
      // Another state file may hold an older conversion of this doctest.
      for (const other of all.values()) {
        if (other !== state && Reflect.deleteProperty(other.files, doctest)) save(other);
      }
      state.files[doctest] = entry;
      // The entry is on disk before the doctest goes.
      save(state);
      unlinkSync(join(REPO, doctest));
    }
    save(state);
    return state;
  } finally {
    rmSync(w.tmp, { recursive: true, force: true });
  }
}
