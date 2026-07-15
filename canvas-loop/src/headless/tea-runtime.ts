import { SketchUsageError } from "./errors.js";
import { FrameRecorder, patchConsole } from "./recorder.js";
import type { RunResult } from "./recorder.js";
import { Sketch } from "./sketch.js";
import { bucketTeaByFrame } from "./tea-events.js";
import type { TeaScriptEvent } from "./tea-events.js";
import { TeaUtil, TeaView } from "./tea-view.js";
import { withGuards } from "./guards.js";
import type { RunMeta } from "./transcript.js";
import type { CanvasSize, Msg, ParamsDecl, ParamValues } from "../core/tea.js";
// Type-only: the loader owns LoadedTeaModule (see tea-load.ts for why it
// lives there and not here).
import type { LoadedTeaModule } from "./tea-load.js";

const DEFAULT_CANVAS: CanvasSize = { width: 400, height: 300 };

export interface TeaRunOptions {
  module: LoadedTeaModule;
  sketchPath: string;
  outDir: string;
  frames: number;
  seed: number;
  fps: number;
  every: number;
  events: readonly TeaScriptEvent[];
  eventsPath: string | undefined;
}

// Reflection over an opaque sketch Model: its property values are genuinely
// unknown, so this one boundary owns the cast the type system can't express.
function ownValues(value: object): unknown[] {
  // eslint-disable-next-line no-restricted-syntax -- parse boundary: Object.values on an opaque Model returns any[]
  return Object.values(value) as unknown[];
}

/** Recursively freeze a model so any later mutation attempt throws (belt over DeepReadonly). */
function deepFreeze(value: unknown, seen: WeakSet<object>): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  for (const child of ownValues(value)) deepFreeze(child, seen);
  Object.freeze(value);
}

function frozenModel(value: unknown): unknown {
  deepFreeze(value, new WeakSet());
  return value;
}

function assertSync(result: unknown, where: string): void {
  if (result === null || typeof result !== "object") return;
  const then = Reflect.get(result, "then");
  if (typeof then === "function") {
    throw new SketchUsageError({ detail: `${where}() returned a Promise — TEA sketches must be synchronous` });
  }
}

function initialParams(decl: ParamsDecl): ParamValues<ParamsDecl> {
  const values: Record<string, number | boolean | string> = {};
  for (const [name, param] of Object.entries(decl)) {
    if (param.type === "trigger") continue;
    values[name] = param.default;
  }
  return Object.freeze(values);
}

class TeaRunner {
  #options: TeaRunOptions;
  #recorder: FrameRecorder;
  #sketch: Sketch;
  #util: TeaUtil<ParamsDecl>;
  #view: TeaView;
  #eventsByFrame: Map<number, TeaScriptEvent[]>;
  #params: ParamValues<ParamsDecl>;
  #model: unknown = undefined;
  #mouseX = 0;
  #mouseY = 0;

  constructor(options: TeaRunOptions) {
    this.#options = options;
    this.#params = initialParams(options.module.params);
    this.#recorder = new FrameRecorder({
      frames: options.frames,
      every: options.every,
      readPixels: () => this.#sketch.readPixels(),
      canvasReady: () => this.#sketch.width > 0 && this.#sketch.height > 0,
    });
    this.#sketch = new Sketch({ host: this.#recorder, seed: options.seed, fps: options.fps });
    this.#util = new TeaUtil({ sketch: this.#sketch, getParams: () => this.#params });
    this.#view = new TeaView(this.#sketch);
    this.#eventsByFrame = bucketTeaByFrame(options.events);
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
      const size = this.#options.module.canvas ?? DEFAULT_CANVAS;
      this.#sketch.createCanvas(size.width, size.height);
      const initial = this.#options.module.init(this.#util);
      assertSync(initial, "init");
      this.#model = frozenModel(initial);
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
    const events = this.#eventsByFrame.get(frame) ?? [];
    this.#recorder.markEvents(events.length > 0);
    for (const event of events) {
      if (event.type === "snapshot") {
        this.#recorder.requestSnapshot(event.label);
        continue;
      }
      this.#fold(this.#toMsg(event));
    }
    this.#fold({ type: "tick", frame });
    const drawn = this.#options.module.draw(this.#view, this.#model, this.#params);
    assertSync(drawn, "draw");
    this.#recorder.captureIfNeeded(frame);
  }

  #fold(msg: Msg): void {
    const next = this.#options.module.update(this.#model, msg, this.#util);
    assertSync(next, "update");
    this.#model = frozenModel(next);
  }

  #toMsg(event: Exclude<TeaScriptEvent, { type: "snapshot" }>): Msg {
    switch (event.type) {
      case "mousedown":
      case "mouseup":
      case "mousemove": {
        if (event.x !== undefined) this.#mouseX = event.x;
        if (event.y !== undefined) this.#mouseY = event.y;
        return { type: event.type, x: this.#mouseX, y: this.#mouseY };
      }
      case "keydown":
      case "keyup":
        return { type: event.type, key: event.key ?? "" };
      case "param": {
        this.#params = Object.freeze({ ...this.#params, [event.name]: event.value });
        this.#recorder.recordParam({ name: event.name, value: event.value });
        return { type: "param", name: event.name, value: event.value };
      }
      case "trigger":
        return { type: "trigger", name: event.name };
    }
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

/** Run a TEA-tier sketch module through the deterministic fold loop and write out/. */
export function teaRun(options: TeaRunOptions): RunResult {
  return new TeaRunner(options).run();
}
