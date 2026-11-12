/**
 * The child half of `bbx figure run`: import a compiled figure entry, run it
 * with canvas-loop's headless runner, and print one JSON result line. Runs in
 * its own process so the parent can kill a sketch that never returns.
 */
import { promises as fs } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseTeaEvents, teaRun, toTeaModule } from "@ianbicking/canvas-loop/headless";
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

function isJob(value: unknown): value is FigureJob {
  return isRecord(value) && typeof value["compiled"] === "string" && typeof value["outDir"] === "string";
}

/** Run the job in `jobFile`; prints `{ transcript?, framesRun?, imageCount?, errors }` as the last stdout line. */
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
  try {
    const module = toTeaModule(imported);
    const rawEvents: unknown = job.events === undefined ? [] : JSON.parse(await fs.readFile(job.events, "utf8"));
    const events = parseTeaEvents(rawEvents, module.params);
    const last = Math.max(-1, ...events.map((event) => event.frame));
    const frames = job.frames ?? (events.length > 0 ? last + 1 + TAIL_FRAMES : DEFAULT_FRAMES);
    const result = teaRun({
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
    });
    process.stdout.write(`${JSON.stringify({ transcript: result.transcriptPath, framesRun: result.framesRun, imageCount: result.imageCount, errors: result.errors })}\n`);
  } catch (error) {
    errors.push(errorMessage(error));
    process.stdout.write(`${JSON.stringify({ errors })}\n`);
  }
}
