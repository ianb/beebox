import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { CliError } from "./errors.js";
import { parseEvents } from "./events.js";
import { run } from "./runtime.js";
import type { RunResult } from "./runtime.js";
import type { Sketch } from "./sketch.js";
import type { SketchEvent, SketchEventHandler, SketchModule } from "./types.js";

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

function loadEvents(path: string): SketchEvent[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    void e;
    throw new CliError({ detail: `cannot read events file: ${path}` });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    void e;
    throw new CliError({ detail: `events file is not valid JSON: ${path}` });
  }
  return parseEvents(json);
}

function reportResult(result: RunResult): void {
  for (const error of result.errors) console.error(error);
  console.log(`${result.transcriptPath} — ${result.framesRun} frames`);
  if (result.errors.length > 0) process.exitCode = 1;
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
    },
  });
  const command = parsed.positionals[0];
  const sketchArg = parsed.positionals[1];
  if (command !== "run") {
    throw new CliError({ detail: `unknown command "${command ?? ""}"; usage: cli run <sketch.ts> [flags]` });
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

  let events: SketchEvent[] = [];
  const eventsPath = values.events;
  if (eventsPath !== undefined) events = loadEvents(resolve(eventsPath));

  const sketchPath = resolve(sketchArg);
  const imported: Record<string, unknown> = await import(pathToFileURL(sketchPath).href);
  const module = toModule(imported);

  reportResult(
    run({ module, sketchPath: sketchArg, outDir, frames, seed, fps, every, events, eventsPath }),
  );
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
