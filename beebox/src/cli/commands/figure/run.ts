/**
 * `bbx figure run`: render a canvas-loop figure headlessly with canvas-loop's
 * own runner, so a box agent can read what it drew and how it answered
 * scripted input without a browser. The entry is compiled with the view
 * compiler for Node, then run in a child process (`figure run-one`) under a
 * timeout, since authored code can loop forever. Output lands in the box's
 * `_tmp/figure-run/<card path, leading underscores dropped>/out/`
 * (transcript.md and frame PNGs).
 *
 * Plan: docs/plans/figure-check.md.
 */
import { spawn } from "node:child_process";
import { existsSync, promises as fs, realpathSync } from "node:fs";
import * as path from "node:path";
import { parseFrontmatterObject } from "../../../cards/frontmatter.js";
import { PACKAGE_ROOT } from "../../../lib/package-root.js";
import { resolveAttachRef } from "../../../shared/attach-path.js";
import { isRecord } from "../../../shared/is-record.js";
import { bundleView } from "../../../webapp/views/compiler/compile.js";

/** What the child runs: everything already resolved to absolute paths. */
export interface FigureJob {
  compiled: string;
  sketchPath: string;
  outDir: string;
  events: string | undefined;
  frames: number | undefined;
  every: number;
  /** Card `params:` defaults (typed) and `--params` values (strings, typed by the child against the module). */
  cardDefaults: Record<string, string | number | boolean>;
  overrides: Record<string, string>;
}

export interface FigureRunResult {
  card: string;
  ok: boolean;
  /** Box-relative transcript path, when the run got that far. */
  transcript?: string;
  framesRun?: number;
  imageCount?: number;
  errors: string[];
  warnings: string[];
}

const RUN_DIR = path.join("_tmp", "figure-run");

class FigureRunError extends Error {
  constructor(options: { detail: string }) {
    super(options.detail);
    this.name = "FigureRunError";
  }
}


/** True when `abs`, with symlinks resolved, is inside the box (also resolved). */
function insideBox(boxRoot: string, abs: string): boolean {
  const rel = path.relative(realpathSync(boxRoot), realpathSync(abs));
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** A box path to `card`, checked: inside the box, a canvas-loop figure card. */
async function readFigureCard(boxRoot: string, card: string): Promise<{ rel: string; frontmatter: Record<string, unknown> }> {
  const abs = path.resolve(boxRoot, card);
  const rel = path.relative(boxRoot, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new FigureRunError({ detail: `${card}: not inside this box` });
  if (!existsSync(abs)) throw new FigureRunError({ detail: `${card}: no such card` });
  if (!insideBox(boxRoot, abs)) throw new FigureRunError({ detail: `${card}: links outside this box` });
  if (!rel.endsWith(".figure.card")) throw new FigureRunError({ detail: `${card}: not a figure card (*.figure.card)` });
  const frontmatter = parseFrontmatterObject(await fs.readFile(abs, "utf8"));
  if (frontmatter === null) throw new FigureRunError({ detail: `${rel}: no frontmatter` });
  if (frontmatter["runtime"] !== "canvas-loop") {
    throw new FigureRunError({ detail: `${rel}: runtime is ${JSON.stringify(frontmatter["runtime"])}; only canvas-loop figures run headlessly` });
  }
  return { rel, frontmatter };
}


/** Resolve an `attach/…` ref against the card, or a box path; must exist. */
function boxFile(args: { boxRoot: string; cardRel: string; ref: string; what: string }): string {
  const { boxRoot, cardRel, ref, what } = args;
  const rel = resolveAttachRef(cardRel.split(path.sep).join("/"), ref) ?? ref;
  const abs = path.resolve(boxRoot, rel);
  const inside = path.relative(boxRoot, abs);
  if (inside.startsWith("..") || path.isAbsolute(inside)) throw new FigureRunError({ detail: `${what} ${ref}: not inside this box` });
  if (!existsSync(abs)) throw new FigureRunError({ detail: `${what} ${ref}: no such file (${inside})` });
  if (!insideBox(boxRoot, abs)) throw new FigureRunError({ detail: `${what} ${ref}: links outside this box` });
  return abs;
}

function cardDefaults(frontmatter: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  const declared = frontmatter["params"];
  if (!Array.isArray(declared)) return out;
  for (const item of declared) {
    if (!isRecord(item) || typeof item["name"] !== "string") continue;
    const value = item["default"];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out[item["name"]] = value;
  }
  return out;
}

/** Prepare the run directory and compiled entry for one card. */
export async function prepareFigureJob(args: {
  boxRoot: string;
  card: string;
  events?: string;
  frames?: number;
  every?: number;
  params: Record<string, string>;
}): Promise<{ cardRel: string; job: FigureJob }> {
  const { boxRoot } = args;
  const { rel, frontmatter } = await readFigureCard(boxRoot, args.card);
  const entryRef = frontmatter["entry"];
  if (typeof entryRef !== "string" || entryRef === "") throw new FigureRunError({ detail: `${rel}: no entry` });
  const entry = boxFile({ boxRoot, cardRel: rel, ref: entryRef, what: "entry" });
  const sibling = path.join(path.dirname(entry), `${path.basename(entry, path.extname(entry))}-events.json`);
  const events = args.events === undefined ? (existsSync(sibling) ? sibling : undefined) : boxFile({ boxRoot, cardRel: rel, ref: args.events, what: "events file" });
  // Box-area names (`_content`, …) are reserved below the root, even under _tmp: drop the underscore.
  const outName = rel.replace(/\.figure\.card$/u, "").split(path.sep).map((segment) => segment.replace(/^_+/u, ""));
  const runDir = path.join(boxRoot, RUN_DIR, ...outName);
  await fs.mkdir(runDir, { recursive: true });
  // The directory is cleared below: refuse one that a symlink leads outside the box.
  if (!insideBox(boxRoot, runDir) || (await fs.lstat(runDir)).isSymbolicLink()) throw new FigureRunError({ detail: `${path.relative(boxRoot, runDir)}: links outside this box` });
  await fs.rm(runDir, { recursive: true, force: true });
  await fs.mkdir(runDir, { recursive: true });
  let output: string;
  try {
    ({ output } = await bundleView(entry, { target: "node", cache: false }));
  } catch (error) {
    throw new FigureRunError({ detail: `compiling ${path.relative(boxRoot, entry)} failed:\n${error instanceof Error ? error.message : String(error)}` });
  }
  const compiled = path.join(runDir, "entry.mjs");
  await fs.writeFile(compiled, output);
  return {
    cardRel: rel,
    job: {
      compiled,
      sketchPath: path.relative(boxRoot, entry),
      outDir: path.join(runDir, "out"),
      events,
      frames: args.frames,
      every: args.every ?? 30,
      cardDefaults: cardDefaults(frontmatter),
      overrides: args.params,
    },
  };
}

/** Lines the transcript logged at warn or error level, for the summary. */
async function transcriptWarnings(transcript: string): Promise<string[]> {
  const text = await fs.readFile(transcript, "utf8").catch(() => "");
  return text.split("\n").filter((line) => /^\*\*\[frame \d+\]\*\* warn: /u.test(line)).map((line) => line.replace(/^\*\*\[frame (\d+)\]\*\* warn: /u, "frame $1: "));
}

/** Run one prepared job in a child `bbx figure run-one`, killed after `timeoutMs`. */
export async function runFigureJob(args: { boxRoot: string; cardRel: string; job: FigureJob; timeoutMs: number }): Promise<FigureRunResult> {
  const { boxRoot, cardRel, job, timeoutMs } = args;
  const jobFile = path.join(path.dirname(job.compiled), "job.json");
  await fs.writeFile(jobFile, JSON.stringify(job));
  const child = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolve) => {
    const proc = spawn(path.join(PACKAGE_ROOT, "bin", "bbx"), ["figure", "run-one", jobFile], {
      cwd: boxRoot,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    proc.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    proc.on("error", (e) => resolve({ code: 1, signal: null, stdout, stderr: `${stderr}${e.message}` }));
    proc.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  if (child.signal === "SIGKILL" && child.code === null) {
    return { card: cardRel, ok: false, errors: [`stopped after ${String(timeoutMs / 1000)} s: a sketch that never returns (an endless loop in init, update or draw?)`], warnings: [] };
  }
  const last = child.stdout.trim().split("\n").at(-1) ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(last);
  } catch (_e) {
    return { card: cardRel, ok: false, errors: [child.stderr.trim() || `figure run-one exited ${String(child.code)} with no result`], warnings: [] };
  }
  if (!isRecord(parsed)) return { card: cardRel, ok: false, errors: ["figure run-one printed no result"], warnings: [] };
  const errors = Array.isArray(parsed["errors"]) ? parsed["errors"].map(String) : [];
  if (child.code !== 0) errors.push(`figure run-one exited ${String(child.code ?? child.signal)}${child.stderr.trim() === "" ? "" : `: ${child.stderr.trim()}`}`);
  const transcript = typeof parsed["transcript"] === "string" ? parsed["transcript"] : undefined;
  return {
    card: cardRel,
    ok: errors.length === 0,
    ...(transcript === undefined ? {} : { transcript: path.relative(boxRoot, transcript) }),
    ...(typeof parsed["framesRun"] === "number" ? { framesRun: parsed["framesRun"] } : {}),
    ...(typeof parsed["imageCount"] === "number" ? { imageCount: parsed["imageCount"] } : {}),
    errors,
    warnings: transcript === undefined ? [] : await transcriptWarnings(transcript),
  };
}

/** Every canvas-loop figure card in the box (box-relative), skipping `_tmp/` and dot directories. */
export async function listCanvasLoopFigures(boxRoot: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "_tmp" || entry.name === "node_modules") continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(abs);
      else if (entry.name.endsWith(".figure.card")) {
        const frontmatter = parseFrontmatterObject(await fs.readFile(abs, "utf8"));
        if (frontmatter?.["runtime"] === "canvas-loop") found.push(path.relative(boxRoot, abs));
      }
    }
  };
  await walk(boxRoot);
  return found.toSorted();
}

export { FigureRunError };
