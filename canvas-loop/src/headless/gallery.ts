// Gallery corpus check (the `cli gallery check` subcommand): renders every
// src/gallery/<slug> exercise, asserts run-twice byte-identical determinism, and
// lints its sketch file. Before rendering, one type check covers every sketch
// and its exports (sketch-types.ts); an exercise with a type error is not rendered. Read-only — the repo's src/gallery/ directory is never
// written to; each run lands in a throwaway temp directory. See
// src/gallery/README.md for the on-disk schema this reads.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { CliError } from "./errors.js";
import type { RunResult } from "./recorder/frame-recorder.js";
import { parseTeaEvents } from "./tea-events.js";
import { checkSketchTypes, formatSketchTypeError } from "./sketch-types.js";
import type { SketchTypeError } from "./sketch-types.js";
import { toTeaModule } from "./tea-load.js";
import { teaRun } from "./tea-runtime/runner.js";

const PACKAGE_ROOT = new URL("../../", import.meta.url);
const GALLERY_DIR = new URL("src/gallery/", PACKAGE_ROOT);
const SKETCH_FILE_NAMES = ["sketch-tea.ts"] as const;

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
  const where = `src/gallery/${slug}/meta.yaml`;
  const raw: unknown = parseYaml(readFileSync(new URL("meta.yaml", exerciseDir), "utf8"));
  if (!isRecord(raw)) throw new CliError({ detail: `${where} must be a YAML mapping` });
  return {
    frames: requiredInt({ record: raw, key: "frames", where }),
    seed: optionalInt({ record: raw, key: "seed", fallback: 42, where }),
    fps: optionalInt({ record: raw, key: "fps", fallback: 60, where }),
    every: optionalInt({ record: raw, key: "every", fallback: 30, where }),
  };
}

function listExerciseSlugs(galleryDir: URL): string[] {
  return readdirSync(galleryDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

function sketchFileName(exerciseDir: URL, slug: string): string {
  for (const name of SKETCH_FILE_NAMES) {
    if (exists(new URL(name, exerciseDir))) return name;
  }
  throw new CliError({ detail: `src/gallery/${slug}: no sketch-tea.ts found` });
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
  const module = toTeaModule(imported);
  const events = hasEvents ? parseTeaEvents(readEventsJson(eventsUrl), module.params) : [];
  return teaRun({ module, events, ...common });
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

async function checkExercise(slug: string, at: { galleryDir: URL; typeErrors: readonly string[] }): Promise<GalleryCheckEntry> {
  const exerciseDir = new URL(`${slug}/`, at.galleryDir);
  try {
    const meta = loadMeta(exerciseDir, slug);
    const sketchFile = sketchFileName(exerciseDir, slug);
    if (at.typeErrors.length > 0) return { slug, ok: false, detail: `type errors, not run:\n${at.typeErrors.join("\n")}` };
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
        detail: `${resultA.framesRun} frames, ${resultA.imageCount} images, deterministic, types and lint clean`,
      };
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  } catch (error) {
    return { slug, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/** The sketch files of the exercises that have one; an exercise without one fails later, in its own entry. */
function sketchPaths(galleryDir: URL, slugs: readonly string[]): string[] {
  return slugs.flatMap((slug) => {
    const exerciseDir = new URL(`${slug}/`, galleryDir);
    return SKETCH_FILE_NAMES.filter((name) => exists(new URL(name, exerciseDir))).map((name) => fileURLToPath(new URL(name, exerciseDir)));
  });
}

/** Each exercise's type errors, formatted, by slug; errors outside every exercise directory under "". */
function typeErrorsBySlug(errors: readonly SketchTypeError[], at: { galleryDir: URL; slugs: readonly string[] }): Map<string, string[]> {
  const root = fileURLToPath(PACKAGE_ROOT);
  const galleryPath = fileURLToPath(at.galleryDir);
  const bySlug = new Map<string, string[]>();
  for (const error of errors) {
    const inGallery = error.file === undefined ? undefined : relative(galleryPath, error.file).split(sep)[0];
    const slug = inGallery !== undefined && at.slugs.includes(inGallery) ? inGallery : "";
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), `  ${formatSketchTypeError(error, root)}`]);
  }
  return bySlug;
}

/**
 * Check every gallery exercise: type-check every sketch and its exports, then
 * render each twice (byte-identical determinism) and lint it. Read-only.
 * `galleryDir` is for tests; the default is src/gallery/.
 */
export async function checkGallery(options?: { galleryDir?: URL }): Promise<GalleryCheckResult> {
  const galleryDir = options?.galleryDir ?? GALLERY_DIR;
  const slugs = listExerciseSlugs(galleryDir);
  const typeErrors = typeErrorsBySlug(await checkSketchTypes(sketchPaths(galleryDir, slugs)), { galleryDir, slugs });
  const entries: GalleryCheckEntry[] = [];
  const outside = typeErrors.get("");
  if (outside !== undefined) entries.push({ slug: "(type check)", ok: false, detail: `type errors outside the exercises:\n${outside.join("\n")}` });
  for (const slug of slugs) {
    entries.push(await checkExercise(slug, { galleryDir, typeErrors: typeErrors.get(slug) ?? [] }));
  }
  return { entries, ok: entries.every((entry) => entry.ok) };
}
