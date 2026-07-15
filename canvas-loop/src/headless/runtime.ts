import { bucketByFrame, dispatchEvent } from "./events.js";
import { FrameRecorder, patchConsole } from "./recorder.js";
import type { RunResult } from "./recorder.js";
import { Sketch } from "./sketch.js";
import type { RunMeta } from "./transcript.js";
import { withGuards } from "./guards.js";
import { SketchUsageError } from "./errors.js";
import type { SketchModule } from "./sketch.js";
import type { ScriptEvent } from "./events.js";
import type { SketchEvent } from "../core/types.js";

// Human description of a scripted input for the transcript. Mouse coords are
// read post-dispatch (applyCoords already ran), keys from the event.
function describeInput(sketch: Sketch, event: SketchEvent): string {
  switch (event.type) {
    case "mousedown":
    case "mouseup":
    case "mousemove":
      return `${event.type} (${sketch.mouseX},${sketch.mouseY})`;
    case "keydown":
    case "keyup":
      return `${event.type} ${event.key ?? ""}`;
  }
}

// The mutable-tier engagement verdict: named acknowledgment wins; else a handler
// export fired (`handled`, bare — no model to diff); else nothing matched.
function verdict(a: { handled: readonly string[]; invoked: boolean }): string {
  if (a.handled.length > 0) return a.handled.join(", ");
  return a.invoked ? "handled" : "(unhandled)";
}

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
  // Per-event engagement accumulator: reset before each dispatch, read after.
  // Sketch.handled pushes here via the injected callback.
  #handledNames: string[] = [];

  constructor(options: RunOptions) {
    this.#options = options;
    this.#recorder = new FrameRecorder({
      frames: options.frames,
      every: options.every,
      readPixels: () => this.#sketch.readPixels(),
      canvasReady: () => this.#sketch.width > 0 && this.#sketch.height > 0,
    });
    this.#sketch = new Sketch({
      host: this.#recorder,
      seed: options.seed,
      fps: options.fps,
      onHandled: (name) => this.#handledNames.push(name),
    });
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
        this.#handledNames = [];
        const invoked = dispatchEvent({ sketch: this.#sketch, module: this.#options.module, event });
        this.#recorder.recordInput({
          event: describeInput(this.#sketch, event),
          verdict: verdict({ handled: this.#handledNames, invoked }),
        });
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
