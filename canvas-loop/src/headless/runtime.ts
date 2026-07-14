import { bucketByFrame, dispatchEvent } from "./events.js";
import { FrameRecorder, patchConsole } from "./recorder.js";
import type { RunResult } from "./recorder.js";
import { Sketch } from "./sketch.js";
import type { RunMeta } from "./transcript.js";
import { withGuards } from "./guards.js";
import { SketchUsageError } from "./errors.js";
import type { SketchModule } from "./sketch.js";
import type { ScriptEvent } from "./events.js";

export interface RunOptions {
  module: SketchModule;
  sketchPath: string;
  outDir: string;
  frames: number;
  seed: number;
  fps: number;
  every: number;
  events: readonly ScriptEvent[];
  eventsPath: string | undefined;
}

export type { RunResult } from "./recorder.js";

class CanvasLoopRunner {
  #options: RunOptions;
  #recorder: FrameRecorder;
  #sketch: Sketch;
  #eventsByFrame: Map<number, ScriptEvent[]>;

  constructor(options: RunOptions) {
    this.#options = options;
    this.#recorder = new FrameRecorder({
      frames: options.frames,
      every: options.every,
      readPixels: () => this.#sketch.readPixels(),
      canvasReady: () => this.#sketch.width > 0 && this.#sketch.height > 0,
    });
    this.#sketch = new Sketch({ host: this.#recorder, seed: options.seed, fps: options.fps });
    this.#eventsByFrame = bucketByFrame(options.events);
  }

  run(): RunResult {
    const restoreConsole = patchConsole(this.#recorder);
    try {
      withGuards(() => this.#execute());
    } finally {
      restoreConsole();
    }
    return this.#recorder.writeOutput(this.#options.outDir, this.#meta());
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
      this.#recorder.recordError(error);
    }
  }

  #runFrame(frame: number): void {
    this.#recorder.beginFrame(frame);
    this.#sketch.frameCount = frame;

    const events = this.#eventsByFrame.get(frame);
    if (events !== undefined) {
      this.#recorder.markEvents(events.length > 0);
      for (const event of events) {
        if (event.type === "snapshot") {
          this.#recorder.requestSnapshot(event.label);
          continue;
        }
        dispatchEvent({ sketch: this.#sketch, module: this.#options.module, event });
      }
    }
    this.#options.module.draw(this.#sketch);
    this.#recorder.captureIfNeeded(frame);
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
}

/** Run a mutable-tier sketch module through the deterministic frame loop and write out/. */
export function run(options: RunOptions): RunResult {
  return new CanvasLoopRunner(options).run();
}
