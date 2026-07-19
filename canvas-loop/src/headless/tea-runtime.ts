import { SketchUsageError, UnhandledMsgError } from "./errors.js";
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

// A scripted INTERACTION event: everything but snapshot (a forced capture) and
// param (which keeps its own `param:` line). These earn an engagement verdict.
type TeaInputEvent = Exclude<TeaScriptEvent, { type: "snapshot" } | { type: "param" }>;
// The Msg an interaction folds as — the Msg union minus tick and param.
type InteractionMsg = Exclude<Msg, { type: "tick" } | { type: "param" }>;

/** Human description of an interaction for the transcript (`mousedown (297,288)`, `keydown ArrowUp`, `trigger reset`). */
function describeInput(msg: InteractionMsg): string {
  switch (msg.type) {
    case "mousedown":
    case "mouseup":
    case "mousemove":
      return `${msg.type} (${msg.x},${msg.y})`;
    case "keydown":
    case "keyup":
      return `${msg.type} ${msg.key}`;
    case "trigger":
      return `trigger ${msg.name}`;
  }
}

/** The engagement verdict: named acknowledgment wins, else a model-reference change, else unhandled. */
function verdict(a: { handled: readonly string[]; changed: boolean }): string {
  if (a.handled.length > 0) return a.handled.join(", ");
  return a.changed ? "Δmodel" : "(unhandled)";
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
  // Per-dispatch engagement accumulator: reset before each interaction fold,
  // read after. TeaUtil.handled and Sketch.handled push here via injected
  // callbacks — the runtime owns it; the capability objects never see it.
  #handledNames: string[] = [];

  constructor(options: TeaRunOptions) {
    this.#options = options;
    this.#params = initialParams(options.module.params);
    this.#recorder = new FrameRecorder({
      frames: options.frames,
      every: options.every,
      readPixels: () => this.#sketch.readPixels(),
      canvasReady: () => this.#sketch.width > 0 && this.#sketch.height > 0,
    });
    const onHandled = (name: string): void => {
      this.#handledNames.push(name);
    };
    this.#sketch = new Sketch({ host: this.#recorder, seed: options.seed, fps: options.fps, onHandled });
    this.#util = new TeaUtil({ sketch: this.#sketch, getParams: () => this.#params, onHandled });
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
    for (const event of events) this.#dispatchEvent(event);
    this.#fold({ type: "tick", frame });
    const drawn = this.#options.module.draw(this.#view, this.#model, this.#params);
    assertSync(drawn, "draw");
    this.#recorder.captureIfNeeded(frame);
  }

  // snapshot forces a capture (no fold); param folds and keeps its dedicated
  // `param:` line (a param change is definitionally applied, so it gets no
  // separate verdict); every other event is a scripted INTERACTION and earns an
  // engagement verdict line.
  #dispatchEvent(event: TeaScriptEvent): void {
    switch (event.type) {
      case "snapshot":
        this.#recorder.requestSnapshot(event.label);
        return;
      case "param": {
        this.#params = Object.freeze({ ...this.#params, [event.name]: event.value });
        this.#recorder.recordParam({ name: event.name, value: event.value });
        this.#fold({ type: "param", name: event.name, value: event.value });
        return;
      }
      case "mousedown":
      case "mouseup":
      case "mousemove":
      case "keydown":
      case "keyup":
      case "trigger":
        this.#dispatchInteraction(event);
        return;
    }
  }

  #dispatchInteraction(event: TeaInputEvent): void {
    const msg = this.#toMsg(event);
    this.#handledNames = [];
    const changed = this.#fold(msg);
    this.#recorder.recordInput({ event: describeInput(msg), verdict: verdict({ handled: this.#handledNames, changed }) });
  }

  #fold(msg: Msg): boolean {
    const next = this.#options.module.update(this.#model, msg, this.#util);
    assertSync(next, "update");
    // A box sketch (no lint) whose update switch omits a Msg case returns
    // undefined here; without this guard the model silently becomes undefined
    // and draw crashes downstream with a confusing error. Fail loud, naming the
    // unhandled msg.type so the author knows which case to add.
    if (next === undefined) throw new UnhandledMsgError({ msgType: msg.type });
    // Reference-change is the free engagement signal — compute before freezing
    // (frozenModel returns the same reference it froze, so it must run first).
    const changed = next !== this.#model;
    this.#model = frozenModel(next);
    return changed;
  }

  #toMsg(event: TeaInputEvent): InteractionMsg {
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
