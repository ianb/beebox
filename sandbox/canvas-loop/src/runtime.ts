import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodePng, frameFileName, hashPixels } from "./capture.js";
import type { Pixels } from "./capture.js";
import { bucketByFrame, dispatchEvent } from "./events.js";
import { formatArgs } from "./format.js";
import { withGuards } from "./guards.js";
import { Sketch } from "./sketch.js";
import { renderTranscript } from "./transcript.js";
import type { RunMeta, TranscriptEntry } from "./transcript.js";
import { SketchUsageError } from "./errors.js";
import type { LogLevel, SketchEvent, SketchModule } from "./types.js";

export interface RunOptions {
  module: SketchModule;
  sketchPath: string;
  outDir: string;
  frames: number;
  seed: number;
  fps: number;
  every: number;
  events: readonly SketchEvent[];
  eventsPath: string | undefined;
}

export interface RunResult {
  transcriptPath: string;
  framesRun: number;
  imageCount: number;
  errors: string[];
}

function normalizeError(error: unknown): { name: string; message: string; stack: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack ?? "" };
  }
  return { name: "Error", message: formatArgs([error]), stack: "" };
}

class CanvasLoopRunner {
  #options: RunOptions;
  #sketch: Sketch;
  #eventsByFrame: Map<number, SketchEvent[]>;
  #entries: TranscriptEntry[] = [];
  #toEncode = new Map<string, Pixels>();
  #currentFrame = 0;
  #framesAttempted = 0;
  #frameHadLog = false;
  #frameHadEvent = false;
  #frameHadSnapshot = false;
  #frameCaptured = false;
  #frameLabels: string[] = [];
  #lastHash: string | undefined;
  #lastFile: string | undefined;
  #errors: string[] = [];

  constructor(options: RunOptions) {
    this.#options = options;
    this.#sketch = new Sketch({ host: this, seed: options.seed, fps: options.fps });
    this.#eventsByFrame = bucketByFrame(options.events);
  }

  // ── SketchHost ───────────────────────────────────────────────────
  recordLog(entry: { level: LogLevel; message: string }): void {
    this.#entries.push({ kind: "log", frame: this.#currentFrame, level: entry.level, message: entry.message });
    this.#frameHadLog = true;
  }

  requestSnapshot(label: string | undefined): void {
    this.#frameHadSnapshot = true;
    if (label !== undefined) this.#frameLabels.push(label);
  }

  // ── run ──────────────────────────────────────────────────────────
  run(): RunResult {
    const restoreConsole = this.#patchConsole();
    try {
      withGuards(() => this.#execute());
    } finally {
      restoreConsole();
    }
    return this.#writeOutput();
  }

  #execute(): void {
    try {
      this.#options.module.setup(this.#sketch);
      if (this.#sketch.width <= 0 || this.#sketch.height <= 0) {
        throw new SketchUsageError({ detail: "setup() must call createCanvas(width, height)" });
      }
      for (let frame = 0; frame < this.#options.frames; frame++) {
        this.#runFrame(frame);
      }
    } catch (error) {
      this.#recordError(error);
    }
  }

  #runFrame(frame: number): void {
    this.#currentFrame = frame;
    this.#sketch.frameCount = frame;
    this.#framesAttempted = frame + 1;
    this.#frameHadLog = false;
    this.#frameHadEvent = false;
    this.#frameHadSnapshot = false;
    this.#frameCaptured = false;
    this.#frameLabels = [];

    const events = this.#eventsByFrame.get(frame);
    if (events !== undefined) {
      this.#frameHadEvent = events.length > 0;
      for (const event of events) {
        dispatchEvent({ sketch: this.#sketch, module: this.#options.module, event });
      }
    }
    this.#options.module.draw(this.#sketch);
    if (this.#shouldCapture(frame)) this.#capture(frame);
  }

  #shouldCapture(frame: number): boolean {
    const { frames, every } = this.#options;
    return (
      frame === 0 ||
      frame === frames - 1 ||
      (every > 0 && frame % every === 0) ||
      this.#frameHadLog ||
      this.#frameHadEvent ||
      this.#frameHadSnapshot
    );
  }

  #capture(frame: number): void {
    const pixels = this.#sketch.readPixels();
    const hash = hashPixels(pixels);
    const labels = this.#frameLabels.slice();
    this.#frameCaptured = true;
    if (hash === this.#lastHash && this.#lastFile !== undefined) {
      this.#entries.push({ kind: "image", frame, labels, file: this.#lastFile, unchanged: true });
      return;
    }
    const file = frameFileName(frame);
    this.#toEncode.set(file, pixels);
    this.#entries.push({ kind: "image", frame, labels, file, unchanged: false });
    this.#lastHash = hash;
    this.#lastFile = file;
  }

  #recordError(error: unknown): void {
    const { name, message, stack } = normalizeError(error);
    if (this.#sketch.width > 0 && this.#sketch.height > 0 && !this.#frameCaptured) {
      this.#capture(this.#currentFrame);
    }
    this.#entries.push({ kind: "error", frame: this.#currentFrame, name, message, stack });
    this.#errors.push(`[frame ${this.#currentFrame}] ${name}: ${message}`);
  }

  #patchConsole(): () => void {
    const original = { log: console.log, warn: console.warn, error: console.error };
    console.log = (...args: unknown[]) => this.recordLog({ level: "log", message: formatArgs(args) });
    console.warn = (...args: unknown[]) => this.recordLog({ level: "warn", message: formatArgs(args) });
    console.error = (...args: unknown[]) => this.recordLog({ level: "error", message: formatArgs(args) });
    return () => {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
    };
  }

  #meta(): RunMeta {
    return {
      sketchPath: this.#options.sketchPath,
      seed: this.#options.seed,
      fps: this.#options.fps,
      frames: this.#options.frames,
      eventsPath: this.#options.eventsPath,
      width: this.#sketch.width,
      height: this.#sketch.height,
    };
  }

  #writeOutput(): RunResult {
    const { outDir } = this.#options;
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    for (const [file, pixels] of this.#toEncode) {
      writeFileSync(join(outDir, file), encodePng(pixels));
    }
    const transcriptPath = join(outDir, "transcript.md");
    writeFileSync(transcriptPath, renderTranscript(this.#meta(), this.#entries));
    return {
      transcriptPath,
      framesRun: this.#framesAttempted,
      imageCount: this.#toEncode.size,
      errors: this.#errors,
    };
  }
}

/** Run a sketch module through the deterministic frame loop and write out/. */
export function run(options: RunOptions): RunResult {
  return new CanvasLoopRunner(options).run();
}
