/**
 * The child half of `bbx figure run`: import a compiled figure entry, run it
 * with canvas-loop's headless runner (`teaRun`: the scene renderer on Dawn),
 * and print one JSON result line. Runs in
 * its own process so the parent can kill a sketch that never returns.
 */
import { promises as fs } from "node:fs";
import { pathToFileURL } from "node:url";
import { NoGpuAdapterError, parseTeaEvents, teaRun, toTeaModule } from "@ianbicking/canvas-loop/headless";
import type { ParamsDecl } from "@ianbicking/canvas-loop";
import { errorMessage } from "../../../shared/error-guards.js";
import { isRecord } from "../../../shared/is-record.js";
import type { FigureJob } from "./run.js";

/** Frames run after the last scripted event when `--frames` is not given. */
const TAIL_FRAMES = 60;
const DEFAULT_FRAMES = 120;

/** Type `--params` strings by the module's declaration; card defaults pass through for declared, valued params. */
function initialParams(decl: ParamsDecl, job: FigureJob): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [name, value] of Object.entries(job.cardDefaults)) {
    const param = decl[name];
    if (param !== undefined && param.type !== "trigger") out[name] = value;
  }
  for (const [name, raw] of Object.entries(job.overrides)) {
    const param = decl[name];
    // Unknown names and triggers go through as strings; the runner names the problem.
    if (param?.type === "number") out[name] = Number(raw);
    else if (param?.type === "boolean") out[name] = raw === "true" || raw === "1" ? true : raw === "false" || raw === "0" ? false : raw;
    else out[name] = raw;
  }
  return out;
}

/**
 * One warning naming the card params the module does not declare, or none.
 * Such a param sets no control and does not reach this run; a factory may
 * still read it from `figure.params`, so it is reported here, once per run,
 * and not in the browser.
 */
export function undeclaredCardParams(decl: ParamsDecl, cardParams: readonly string[]): string[] {
  const missing = cardParams.filter((name) => decl[name] === undefined);
  if (missing.length === 0) return [];
  return [`card params not in the module's params: ${missing.join(", ")}. They set no control and are not set in this run; the factory still reads them from figure.params`];
}

/**
 * The error line for a run that threw. No GPU adapter is the host's problem,
 * not the sketch's, so its text says to ask the boxholder.
 */
export function runErrorText(error: unknown): string {
  if (error instanceof NoGpuAdapterError) {
    return "no GPU adapter: Dawn found no GPU it can use here. Possible causes: no Vulkan driver is installed (on Linux, Mesa's mesa-vulkan-drivers), the driver does not load inside the box's sandbox, or the driver rejects this machine. Ask the boxholder; rewriting the sketch will not help.";
  }
  return errorMessage(error);
}

function isJob(value: unknown): value is FigureJob {
  return isRecord(value) && typeof value["compiled"] === "string" && typeof value["outDir"] === "string";
}

/** Run the job in `jobFile`; prints `{ transcript?, framesRun?, imageCount?, errors, warnings? }` as the last stdout line. */
export async function runFigureOne(jobFile: string): Promise<void> {
  const errors: string[] = [];
  const parsed: unknown = JSON.parse(await fs.readFile(jobFile, "utf8"));
  if (!isJob(parsed)) {
    process.stdout.write(`${JSON.stringify({ errors: ["figure run-one: malformed job file"] })}\n`);
    return;
  }
  const job = parsed;
  let imported: unknown;
  try {
    imported = await import(pathToFileURL(job.compiled).href);
  } catch (error) {
    const hint = /is not defined/u.test(errorMessage(error)) ? " (browser-only code such as window, document or matchMedia must stay inside the default export's factory)" : "";
    errors.push(`loading the entry failed: ${errorMessage(error)}${hint}`);
    process.stdout.write(`${JSON.stringify({ errors })}\n`);
    return;
  }
  if (!isRecord(imported)) {
    process.stdout.write(`${JSON.stringify({ errors: ["the entry has no exports"] })}\n`);
    return;
  }
  // Named before the run, so a run that fails (no GPU) still reports them.
  let warnings: string[] = [];
  try {
    const module = toTeaModule(imported);
    warnings = undeclaredCardParams(module.params, job.cardParams);
    const rawEvents: unknown = job.events === undefined ? [] : JSON.parse(await fs.readFile(job.events, "utf8"));
    const events = parseTeaEvents(rawEvents, module.params);
    const last = Math.max(-1, ...events.map((event) => event.frame));
    const frames = job.frames ?? (events.length > 0 ? last + 1 + TAIL_FRAMES : DEFAULT_FRAMES);
    const result = await teaRun({
      module,
      sketchPath: job.sketchPath,
      outDir: job.outDir,
      frames,
      seed: 42,
      fps: 60,
      every: job.every,
      events,
      eventsPath: job.events,
      initialParams: initialParams(module.params, job),
      scene: job.scene,
    });
    process.stdout.write(`${JSON.stringify({ transcript: result.transcriptPath, framesRun: result.framesRun, imageCount: result.imageCount, errors: result.errors, warnings })}\n`);
  } catch (error) {
    errors.push(runErrorText(error));
    // The runner wrote a transcript (its header and the failure line) before it threw.
    const transcript = error instanceof NoGpuAdapterError ? error.transcriptPath : undefined;
    process.stdout.write(`${JSON.stringify({ ...(transcript === undefined ? {} : { transcript }), errors, warnings })}\n`);
  }
}
