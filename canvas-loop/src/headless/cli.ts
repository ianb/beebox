import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { loadImage, Canvas } from "@napi-rs/canvas";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { CliError } from "./errors.js";
import { parseEvents } from "./events.js";
import { checkGallery } from "./gallery.js";
import type { GalleryCheckResult } from "./gallery.js";
import type { RunResult } from "./recorder/frame-recorder.js";
import { run } from "./runtime.js";
import { isTeaModule, toTeaModule } from "./tea-load.js";
import { parseTeaEvents } from "./tea-events.js";
import { teaRun } from "./tea-runtime.js";
import { encodeZoomPng, parseZoom } from "./recorder/zoom.js";
import { statsLine, writeDiff } from "./diff.js";
import { CHECKPOINT_ENV, saveCheckpoint } from "./checkpoint/save.js";
import { checkpointPage } from "./checkpoint/page.js";
import type { ScriptEvent } from "./events.js";
import type { Sketch, SketchEventHandler, SketchModule } from "./sketch.js";

const OPTIONAL_HANDLERS = [
  "mousePressed",
  "mouseReleased",
  "mouseMoved",
  "mouseDragged",
  "keyPressed",
  "keyReleased",
] as const;

function readFn<T>(mod: Record<string, unknown>, name: string): T | undefined {
  const value = mod[name];
  if (typeof value !== "function") return undefined;
  // eslint-disable-next-line no-restricted-syntax -- parse boundary: dynamic sketch exports are `unknown`; validated typeof === "function" above
  return value as T;
}

function toModule(mod: Record<string, unknown>): SketchModule {
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

function intOption(params: { value: string | undefined; fallback: number; name: string }): number {
  const { value, fallback, name } = params;
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new CliError({ detail: `--${name} must be an integer, got "${value}"` });
  }
  return parsed;
}

function readEventsJson(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    void e;
    throw new CliError({ detail: `cannot read events file: ${path}` });
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    void e;
    throw new CliError({ detail: `events file is not valid JSON: ${path}` });
  }
}

function reportResult(result: RunResult): void {
  for (const error of result.errors) console.error(error);
  console.log(`${result.transcriptPath} — ${result.framesRun} frames`);
  if (result.errors.length > 0) process.exitCode = 1;
}

function reportGalleryResult(result: GalleryCheckResult): void {
  for (const entry of result.entries) {
    console.log(`${entry.ok ? "PASS" : "FAIL"}  ${entry.slug} — ${entry.detail}`);
  }
  if (!result.ok) process.exitCode = 1;
}

/** `cli zoom <frame.png> <spec>...`: write enlarged crops of an existing frame beside it. */
async function zoomFile(args: readonly string[]): Promise<void> {
  const [file, ...specs] = args;
  if (file === undefined || specs.length === 0) {
    throw new CliError({ detail: "usage: cli zoom <frame.png> <x,y,w,h[@scale]>..." });
  }
  const image = await loadImage(resolve(file));
  const canvas = new Canvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, image.width, image.height);
  for (const [index, spec] of specs.entries()) {
    const out = join(dirname(resolve(file)), `${basename(file, ".png")}-crop${index + 1}.png`);
    writeFileSync(out, encodeZoomPng(pixels, parseZoom(spec)));
    console.log(out);
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      frames: { type: "string" },
      events: { type: "string" },
      out: { type: "string" },
      seed: { type: "string" },
      fps: { type: "string" },
      every: { type: "string" },
      zoom: { type: "string", multiple: true },
      timing: { type: "boolean" },
      outline: { type: "boolean" },
      note: { type: "string" },
      title: { type: "string" },
    },
  });
  const command = parsed.positionals[0];
  if (command === "gallery") {
    const sub = parsed.positionals[1];
    if (sub !== "check") {
      throw new CliError({ detail: `unknown gallery subcommand "${sub ?? ""}"; usage: cli gallery check` });
    }
    reportGalleryResult(await checkGallery());
    return;
  }
  if (command === "diff") {
    const [before, after] = parsed.positionals.slice(1);
    if (before === undefined || after === undefined) {
      throw new CliError({ detail: "usage: cli diff <before.png> <after.png> [--out dir]" });
    }
    const outDir = resolve(parsed.values.out ?? "diff");
    const { stats } = await writeDiff(resolve(before), { after: resolve(after), outDir });
    console.log(`${outDir} — ${statsLine(stats)}`);
    return;
  }
  if (command === "checkpoints") {
    const dir = parsed.positionals[1];
    if (dir === undefined) throw new CliError({ detail: "usage: cli checkpoints <dir> [--out page.html] [--title text]" });
    const out = resolve(parsed.values.out ?? join(dir, "index.html"));
    writeFileSync(out, checkpointPage(resolve(dir), parsed.values.title ?? "How this drawing was made"));
    console.log(out);
    return;
  }
  if (command === "zoom") {
    await zoomFile(parsed.positionals.slice(1));
    return;
  }
  const sketchArg = parsed.positionals[1];
  if (command !== "run") {
    throw new CliError({
      detail: `unknown command "${command ?? ""}"; usage: cli run <sketch.ts> [flags] | cli zoom <frame.png> <x,y,w,h[@scale]>... | cli diff <before.png> <after.png> | cli gallery check`,
    });
  }
  if (sketchArg === undefined) {
    throw new CliError({ detail: "missing <sketch.ts> argument" });
  }
  const values = parsed.values;
  const frames = intOption({ value: values.frames, fallback: 120, name: "frames" });
  const seed = intOption({ value: values.seed, fallback: 42, name: "seed" });
  const fps = intOption({ value: values.fps, fallback: 60, name: "fps" });
  const every = intOption({ value: values.every, fallback: 30, name: "every" });
  const outDir = resolve(values.out ?? "out");
  const eventsPath = values.events;
  const zooms = (values.zoom ?? []).map((spec) => parseZoom(spec));
  const common = { sketchPath: sketchArg, outDir, frames, seed, fps, every, eventsPath, zooms, timing: values.timing === true, outline: values.outline === true };

  const sketchPath = resolve(sketchArg);
  const imported: Record<string, unknown> = await import(pathToFileURL(sketchPath).href);

  if (isTeaModule(imported)) {
    const module = toTeaModule(imported);
    const events = eventsPath === undefined ? [] : parseTeaEvents(readEventsJson(resolve(eventsPath)), module.params);
    finishRun(teaRun({ module, events, ...common }), { sketchPath, eventsPath, outDir, note: values.note });
    return;
  }
  const module = toModule(imported);
  let events: ScriptEvent[] = [];
  if (eventsPath !== undefined) events = parseEvents(readEventsJson(resolve(eventsPath)));
  finishRun(run({ module, events, ...common }), { sketchPath, eventsPath, outDir, note: values.note });
}

/** Report the run, and save a checkpoint when CANVAS_LOOP_CHECKPOINTS names a directory. */
function finishRun(result: RunResult, made: { sketchPath: string; eventsPath: string | undefined; outDir: string; note: string | undefined }): void {
  reportResult(result);
  const dir = process.env[CHECKPOINT_ENV];
  if (dir === undefined || dir === "") return;
  const events = made.eventsPath === undefined ? undefined : resolve(made.eventsPath);
  const saved = saveCheckpoint(resolve(dir), { ...made, eventsPath: events, args: process.argv.slice(2), errors: result.errors });
  console.log(`checkpoint ${saved}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
