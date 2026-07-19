// Gallery corpus check (the `cli gallery check` subcommand): renders every
// gallery/<slug> exercise, asserts run-twice byte-identical determinism, and
// lints its sketch file. Read-only — the repo's gallery/ directory is never
// written to; each run lands in a throwaway temp directory. See
// gallery/README.md for the on-disk schema this reads.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { CliError } from "./errors.js";
import { parseEvents } from "./events.js";
import type { ScriptEvent } from "./events.js";
import type { RunResult } from "./recorder.js";
import { run } from "./runtime.js";
import type { Sketch, SketchEventHandler, SketchModule } from "./sketch.js";
import { parseTeaEvents } from "./tea-events.js";
import { isTeaModule, toTeaModule } from "./tea-load.js";
import { teaRun } from "./tea-runtime.js";

const PACKAGE_ROOT = new URL("../../", import.meta.url);
const GALLERY_DIR = new URL("gallery/", PACKAGE_ROOT);
const SKETCH_FILE_NAMES = ["sketch-tea.ts", "sketch.ts"] as const;

const OPTIONAL_HANDLERS = [
  "mousePressed",
  "mouseReleased",
  "mouseMoved",
  "mouseDragged",
  "keyPressed",
  "keyReleased",
] as const;

interface GalleryMeta {
  frames: number;
  seed: number;
  fps: number;
  every: number;
}

/** One exercise's check outcome. */
export interface GalleryCheckEntry {
  slug: string;
  ok: boolean;
  detail: string;
}

/** The full `gallery check` report. */
export interface GalleryCheckResult {
  entries: GalleryCheckEntry[];
  ok: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function exists(url: URL): boolean {
  try {
    statSync(url);
    return true;
  } catch (error) {
    void error;
    return false;
  }
}

function requiredInt(params: { record: Record<string, unknown>; key: string; where: string }): number {
  const { record, key, where } = params;
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new CliError({ detail: `${where}: "${key}" must be a positive integer` });
  }
  return value;
}

function optionalInt(params: { record: Record<string, unknown>; key: string; fallback: number; where: string }): number {
  const { record, key, fallback, where } = params;
  const value = record[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new CliError({ detail: `${where}: "${key}" must be an integer` });
  }
  return value;
}

function loadMeta(exerciseDir: URL, slug: string): GalleryMeta {
  const where = `gallery/${slug}/meta.yaml`;
  const raw: unknown = parseYaml(readFileSync(new URL("meta.yaml", exerciseDir), "utf8"));
  if (!isRecord(raw)) throw new CliError({ detail: `${where} must be a YAML mapping` });
  return {
    frames: requiredInt({ record: raw, key: "frames", where }),
    seed: optionalInt({ record: raw, key: "seed", fallback: 42, where }),
    fps: optionalInt({ record: raw, key: "fps", fallback: 60, where }),
    every: optionalInt({ record: raw, key: "every", fallback: 30, where }),
  };
}

function listExerciseSlugs(): string[] {
  return readdirSync(GALLERY_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

function sketchFileName(exerciseDir: URL, slug: string): string {
  for (const name of SKETCH_FILE_NAMES) {
    if (exists(new URL(name, exerciseDir))) return name;
  }
  throw new CliError({ detail: `gallery/${slug}: no sketch.ts or sketch-tea.ts found` });
}

function readFn<T>(mod: Record<string, unknown>, name: string): T | undefined {
  const value = mod[name];
  if (typeof value !== "function") return undefined;
  // eslint-disable-next-line no-restricted-syntax -- parse boundary: dynamic sketch exports are `unknown`; validated typeof === "function" above
  return value as T;
}

function toMutableModule(mod: Record<string, unknown>): SketchModule {
  const setup = readFn<(s: Sketch) => void>(mod, "setup");
  const draw = readFn<(s: Sketch) => void>(mod, "draw");
  if (setup === undefined || draw === undefined) {
    throw new CliError({ detail: "sketch must export setup(s) and draw(s) functions" });
  }
  const module: SketchModule = { setup, draw };
  for (const name of OPTIONAL_HANDLERS) {
    const handler = readFn<SketchEventHandler>(mod, name);
    if (handler !== undefined) module[name] = handler;
  }
  return module;
}

function readEventsJson(eventsUrl: URL): unknown {
  return JSON.parse(readFileSync(eventsUrl, "utf8"));
}

async function runOnce(params: { exerciseDir: URL; sketchFile: string; meta: GalleryMeta; outDir: string }): Promise<RunResult> {
  const { exerciseDir, sketchFile, meta, outDir } = params;
  const eventsUrl = new URL("events.json", exerciseDir);
  const hasEvents = exists(eventsUrl);
  const imported: Record<string, unknown> = await import(new URL(sketchFile, exerciseDir).href);
  const common = {
    sketchPath: sketchFile,
    outDir,
    frames: meta.frames,
    seed: meta.seed,
    fps: meta.fps,
    every: meta.every,
    eventsPath: hasEvents ? "events.json" : undefined,
  };
  if (isTeaModule(imported)) {
    const module = toTeaModule(imported);
    const events = hasEvents ? parseTeaEvents(readEventsJson(eventsUrl), module.params) : [];
    return teaRun({ module, events, ...common });
  }
  const module = toMutableModule(imported);
  const events: ScriptEvent[] = hasEvents ? parseEvents(readEventsJson(eventsUrl)) : [];
  return run({ module, events, ...common });
}

function collectFiles(dir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (const name of readdirSync(dir)) {
    out.set(name, readFileSync(join(dir, name)));
  }
  return out;
}

/** Compare two run-output directories; returns a mismatch description, or undefined if byte-identical. */
function diffDeterminism(runA: string, runB: string): string | undefined {
  const filesA = collectFiles(runA);
  const filesB = collectFiles(runB);
  if (filesA.size !== filesB.size) {
    return `output file count differs between runs (${filesA.size} vs ${filesB.size})`;
  }
  for (const [name, bufA] of filesA) {
    const bufB = filesB.get(name);
    if (bufB === undefined) return `${name}: present in run 1 but not run 2`;
    if (!bufA.equals(bufB)) return `${name}: differs between runs — not deterministic`;
  }
  return undefined;
}

function execErrorDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  // eslint-disable-next-line no-restricted-syntax -- parse boundary: execFileSync errors carry untyped stdout/stderr fields
  const withOutput = error as Error & { stdout?: string; stderr?: string };
  const output = [withOutput.stdout, withOutput.stderr].filter((s): s is string => typeof s === "string" && s.length > 0);
  return output.length > 0 ? output.join("\n").trim() : error.message;
}

function lintSketch(exerciseDir: URL, sketchFile: string): string | undefined {
  const packageRoot = fileURLToPath(PACKAGE_ROOT);
  const sketchPath = fileURLToPath(new URL(sketchFile, exerciseDir));
  const relPath = relative(packageRoot, sketchPath);
  try {
    execFileSync("pnpm", ["exec", "eslint", relPath], { cwd: packageRoot, stdio: "pipe", encoding: "utf8" });
    return undefined;
  } catch (error) {
    return `eslint failed on ${relPath}:\n${execErrorDetail(error)}`;
  }
}

async function checkExercise(slug: string): Promise<GalleryCheckEntry> {
  const exerciseDir = new URL(`${slug}/`, GALLERY_DIR);
  try {
    const meta = loadMeta(exerciseDir, slug);
    const sketchFile = sketchFileName(exerciseDir, slug);
    const base = mkdtempSync(join(tmpdir(), "canvas-loop-gallery-"));
    try {
      const outA = join(base, "run-a");
      const outB = join(base, "run-b");
      const resultA = await runOnce({ exerciseDir, sketchFile, meta, outDir: outA });
      if (resultA.errors.length > 0) return { slug, ok: false, detail: `run failed: ${resultA.errors.join("; ")}` };
      const resultB = await runOnce({ exerciseDir, sketchFile, meta, outDir: outB });
      if (resultB.errors.length > 0) return { slug, ok: false, detail: `run failed: ${resultB.errors.join("; ")}` };
      const diff = diffDeterminism(outA, outB);
      if (diff !== undefined) return { slug, ok: false, detail: diff };
      const lintError = lintSketch(exerciseDir, sketchFile);
      if (lintError !== undefined) return { slug, ok: false, detail: lintError };
      return {
        slug,
        ok: true,
        detail: `${resultA.framesRun} frames, ${resultA.imageCount} images, deterministic, lint clean`,
      };
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  } catch (error) {
    return { slug, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/** Check every gallery exercise: render twice (byte-identical determinism), lint. Read-only. */
export async function checkGallery(): Promise<GalleryCheckResult> {
  const entries: GalleryCheckEntry[] = [];
  for (const slug of listExerciseSlugs()) {
    entries.push(await checkExercise(slug));
  }
  return { entries, ok: entries.every((entry) => entry.ok) };
}
