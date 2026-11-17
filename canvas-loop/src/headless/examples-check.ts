// The examples check (`cli examples check`, `pnpm examples:check`): every
// src/examples/<name>-tea.ts runs its <name>-tea-events.json twice. An example
// passes when its sketch type-checks and lints, the run is warning-free, every
// scripted input engages, and the two runs write identical bytes. The events
// file sets the run length: its last frame holds a snapshot. Read-only; runs
// land in a temp directory.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { CliError } from "./errors.js";
import type { RunResult } from "./recorder/frame-recorder.js";
import { parseTeaEvents } from "./tea-events.js";
import type { TeaScriptEvent } from "./tea-events.js";
import { checkSketchTypes, formatSketchTypeError } from "./sketch-types.js";
import type { SketchTypeError } from "./sketch-types.js";
import { toTeaModule } from "./tea-load.js";
import { teaRun } from "./tea-runtime/runner.js";

const PACKAGE_ROOT = new URL("../../", import.meta.url);
const EXAMPLES_DIR = new URL("src/examples/", PACKAGE_ROOT);
const SKETCH_SUFFIX = "-tea.ts";
const EVENTS_SUFFIX = "-tea-events.json";
const RUN = { seed: 42, fps: 60, every: 30 } as const;

/** One example's check outcome. */
export interface ExampleCheckEntry {
  name: string;
  ok: boolean;
  detail: string;
}

/** The full `examples check` report. */
export interface ExampleCheckResult {
  entries: ExampleCheckEntry[];
  ok: boolean;
}

const FRAMED_LOG = /^\*\*\[frame \d+\]\*\* (?:warn|error): /u;
const UNHANDLED_INPUT = /^\*\*\[frame \d+\]\*\* .* → \(unhandled\)$/u;

/** The transcript lines an example may not have: a framed `warn:` or `error:` log line, and a scripted input that read `(unhandled)`. */
export function transcriptProblems(text: string): string[] {
  return text.split("\n").filter((line) => FRAMED_LOG.test(line) || UNHANDLED_INPUT.test(line));
}

function exampleNames(examplesDir: URL): string[] {
  return readdirSync(examplesDir)
    .filter((file) => file.endsWith(SKETCH_SUFFIX))
    .map((file) => file.slice(0, -SKETCH_SUFFIX.length))
    .toSorted();
}

function sketchUrl(examplesDir: URL, name: string): URL {
  return new URL(`${name}${SKETCH_SUFFIX}`, examplesDir);
}

/** The run length the events file sets: frames 0 … its last frame, which must hold a snapshot. */
function runFrames(events: readonly TeaScriptEvent[]): number {
  const last = Math.max(...events.map((event) => event.frame));
  if (!events.some((event) => event.frame === last && event.type === "snapshot")) {
    throw new CliError({ detail: "end the events file with a snapshot at its last frame" });
  }
  return last + 1;
}

interface Prepared {
  module: ReturnType<typeof toTeaModule>;
  events: TeaScriptEvent[];
  frames: number;
}

async function prepare(examplesDir: URL, name: string): Promise<Prepared> {
  const eventsUrl = new URL(`${name}${EVENTS_SUFFIX}`, examplesDir);
  if (!existsSync(eventsUrl)) throw new CliError({ detail: `no events file: add ${name}${EVENTS_SUFFIX} beside the sketch` });
  const imported: Record<string, unknown> = await import(sketchUrl(examplesDir, name).href);
  const module = toTeaModule(imported);
  const raw: unknown = JSON.parse(readFileSync(eventsUrl, "utf8"));
  const events = parseTeaEvents(raw, module.params);
  return { module, events, frames: runFrames(events) };
}

function runOnce(prepared: Prepared, at: { name: string; outDir: string }): Promise<RunResult> {
  return teaRun({
    module: prepared.module,
    events: prepared.events,
    frames: prepared.frames,
    sketchPath: `${at.name}${SKETCH_SUFFIX}`,
    eventsPath: `${at.name}${EVENTS_SUFFIX}`,
    outDir: at.outDir,
    ...RUN,
  });
}

function collectFiles(dir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (const name of readdirSync(dir)) out.set(name, readFileSync(join(dir, name)));
  return out;
}

/** Compare two run-output directories; returns a mismatch description, or undefined if byte-identical. */
function diffDeterminism(runA: string, runB: string): string | undefined {
  const filesA = collectFiles(runA);
  const filesB = collectFiles(runB);
  if (filesA.size !== filesB.size) return `output file count differs between runs (${filesA.size} vs ${filesB.size})`;
  for (const [name, bufA] of filesA) {
    const bufB = filesB.get(name);
    if (bufB === undefined) return `${name}: present in run 1 but not run 2`;
    if (!bufA.equals(bufB)) return `${name}: differs between runs — not deterministic`;
  }
  return undefined;
}

async function renderExample(prepared: Prepared, name: string): Promise<ExampleCheckEntry> {
  const base = mkdtempSync(join(tmpdir(), "canvas-loop-examples-"));
  try {
    const outA = join(base, "run-a");
    const outB = join(base, "run-b");
    const resultA = await runOnce(prepared, { name, outDir: outA });
    if (resultA.errors.length > 0) return { name, ok: false, detail: `run failed: ${resultA.errors.join("; ")}` };
    const problems = transcriptProblems(readFileSync(join(outA, "transcript.md"), "utf8"));
    if (problems.length > 0) return { name, ok: false, detail: `the transcript has warnings or unhandled inputs:\n${problems.map((line) => `  ${line}`).join("\n")}` };
    const resultB = await runOnce(prepared, { name, outDir: outB });
    if (resultB.errors.length > 0) return { name, ok: false, detail: `second run failed: ${resultB.errors.join("; ")}` };
    const diff = diffDeterminism(outA, outB);
    if (diff !== undefined) return { name, ok: false, detail: diff };
    return { name, ok: true, detail: `${resultA.framesRun} frames, ${resultA.imageCount} images; clean, deterministic, types and lint clean` };
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

async function checkExample(examplesDir: URL, at: { name: string; lintErrors: ReadonlyMap<string, string> }): Promise<ExampleCheckEntry> {
  const { name } = at;
  try {
    const prepared = await prepare(examplesDir, name);
    const lint = at.lintErrors.get(name);
    if (lint !== undefined) return { name, ok: false, detail: lint };
    return await renderExample(prepared, name);
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

function execOutput(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  // eslint-disable-next-line no-restricted-syntax -- parse boundary: execFileSync errors carry untyped stdout/stderr fields
  const withOutput = error as Error & { stdout?: string };
  return withOutput.stdout;
}

interface LintFileResult {
  filePath: string;
  messages: readonly { line: number; column: number; ruleId: string | null; message: string }[];
}

/** One eslint run over every example inside the package; its failures by example name. Outside the package nothing is linted. */
function lintExamples(examplesDir: URL, names: readonly string[]): Map<string, string> {
  const packageRoot = fileURLToPath(PACKAGE_ROOT);
  const files = names.map((name) => relative(packageRoot, fileURLToPath(sketchUrl(examplesDir, name))));
  const inside = files.filter((file) => !file.startsWith(".."));
  if (inside.length === 0) return new Map();
  let output: string;
  try {
    output = execFileSync("pnpm", ["exec", "eslint", "--format", "json", ...inside], { cwd: packageRoot, stdio: "pipe", encoding: "utf8" });
  } catch (error) {
    const stdout = execOutput(error);
    if (stdout === undefined || stdout.length === 0) throw error;
    output = stdout;
  }
  // eslint-disable-next-line no-restricted-syntax -- parse boundary: eslint's documented JSON formatter output
  const results = JSON.parse(output) as LintFileResult[];
  const failures = new Map<string, string>();
  for (const result of results) {
    if (result.messages.length === 0) continue;
    const name = result.filePath.split("/").at(-1)?.slice(0, -SKETCH_SUFFIX.length) ?? result.filePath;
    const lines = result.messages.map((m) => `  ${m.line}:${m.column} ${m.message} (${m.ruleId ?? "eslint"})`);
    failures.set(name, `eslint failed on ${relative(packageRoot, result.filePath)}:\n${lines.join("\n")}`);
  }
  return failures;
}

/** Each example's type errors, formatted, by name; errors in any other file under "". */
function typeErrorsByName(errors: readonly SketchTypeError[], at: { examplesDir: URL; names: readonly string[] }): Map<string, string[]> {
  const root = fileURLToPath(PACKAGE_ROOT);
  const byFile = new Map(at.names.map((name) => [fileURLToPath(sketchUrl(at.examplesDir, name)), name]));
  const byName = new Map<string, string[]>();
  for (const error of errors) {
    const name = (error.file === undefined ? undefined : byFile.get(error.file)) ?? "";
    byName.set(name, [...(byName.get(name) ?? []), `  ${formatSketchTypeError(error, root)}`]);
  }
  return byName;
}

/**
 * Check every example: type-check all sketches, then lint and render each one
 * twice from its events file. Read-only. `examplesDir` is for tests; the
 * default is src/examples/.
 */
export async function checkExamples(options?: { examplesDir?: URL }): Promise<ExampleCheckResult> {
  const examplesDir = options?.examplesDir ?? EXAMPLES_DIR;
  const names = exampleNames(examplesDir);
  const sketches = names.map((name) => fileURLToPath(sketchUrl(examplesDir, name)));
  const typeErrors = typeErrorsByName(await checkSketchTypes(sketches), { examplesDir, names });
  const entries: ExampleCheckEntry[] = [];
  const outside = typeErrors.get("");
  if (outside !== undefined) entries.push({ name: "(type check)", ok: false, detail: `type errors outside the examples:\n${outside.join("\n")}` });
  if (typeErrors.size > 0) {
    // A type error stops every render: an example's imports may be shared.
    for (const name of names) {
      const own = typeErrors.get(name);
      entries.push({ name, ok: false, detail: own === undefined ? "not run: the type check failed (see the entries with type errors)" : `type errors, not run:\n${own.join("\n")}` });
    }
    return { entries, ok: false };
  }
  const lintErrors = lintExamples(examplesDir, names);
  for (const name of names) entries.push(await checkExample(examplesDir, { name, lintErrors }));
  return { entries, ok: entries.every((entry) => entry.ok) };
}
