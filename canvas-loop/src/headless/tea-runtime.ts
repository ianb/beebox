import { DeterminismError, SketchUsageError, UnhandledMsgError } from "./errors.js";
import { ActivityReporter } from "../core/activity.js";
import { FrameRecorder, patchConsole } from "./recorder/frame-recorder.js";
import type { Zoom } from "./recorder/zoom.js";
import { FrameTimer } from "./recorder/timing.js";
import type { RunResult } from "./recorder/frame-recorder.js";
import { Surface } from "./surface.js";
import { Score, voiceDetail } from "../core/sound/voice.js";
import { soundFiles } from "./recorder/sound.js";
import { UnhandledFold, describeInput, verdict } from "../core/engagement.js";
import { checkParam } from "../browser/param-validate.js";
import type { InteractionMsg } from "../core/engagement.js";
import { bucketTeaByFrame } from "./tea-events.js";
import type { TeaScriptEvent } from "./tea-events.js";
import { TeaUtil, TeaView } from "./tea-view.js";
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
  /** Regions to write as enlarged crops beside every captured frame (`--zoom`). */
  zooms?: readonly Zoom[];
  /** Add a timing summary line to the transcript (`--timing`). */
  timing?: boolean;
  /** Outline placed sprites, clips and `debugBox`es over each frame (`--outline`). */
  outline?: boolean;
  events: readonly TeaScriptEvent[];
  eventsPath: string | undefined;
  /** Start params other than the declared defaults (checked against the declaration). */
  initialParams?: Readonly<Record<string, number | boolean | string>>;
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

/** Declared defaults, with `overrides` applied; an unknown name or a value the declaration rejects (or would clamp) is an error. */
function initialParams(decl: ParamsDecl, overrides: Readonly<Record<string, number | boolean | string>> | undefined): ParamValues<ParamsDecl> {
  const values: Record<string, number | boolean | string> = {};
  for (const [name, param] of Object.entries(decl)) {
    if (param.type === "trigger") continue;
    values[name] = param.default;
  }
  for (const [name, value] of Object.entries(overrides ?? {})) {
    const param = decl[name];
    if (param === undefined) throw new SketchUsageError({ detail: `initial param "${name}": the sketch declares no such param` });
    const check = checkParam(param, value);
    if (!check.ok) throw new SketchUsageError({ detail: `initial param "${name}": ${check.reason}` });
    if (check.note !== undefined) throw new SketchUsageError({ detail: `initial param "${name}": ${String(value)} is outside the declared range` });
    values[name] = check.value;
  }
  return Object.freeze(values);
}

// A scripted INTERACTION event: everything but snapshot (a forced capture) and
// param (which keeps its own `param:` line). These earn an engagement verdict.
type TeaInputEvent = Exclude<TeaScriptEvent, { type: "snapshot" } | { type: "param" }>;



/**
 * Run `body` with the ambient nondeterministic globals virtualized: Math.random,
 * Date.now, performance.now, and argless `new Date()` / `Date()` all throw a
 * DeterminismError pointing at the sketch's seeded `random()` / `millis()`.
 * Originals are always restored, even if `body` throws.
 *
 * `body` must be fully synchronous — the guards are installed process-wide for
 * its duration, so nothing async should run underneath them.
 */
function withGuards<T>(body: () => T): T {
  const realRandom = Math.random;
  const realDateNow = Date.now;
  const realPerfNow = performance.now;
  const realDate = globalThis.Date;

  const guardedDate = new Proxy(realDate, {
    construct(target, args) {
      if (args.length === 0) {
        throw new DeterminismError({ api: "new Date", use: "a frame count from the tick msg" });
      }
      return Reflect.construct(target, args);
    },
    apply() {
      throw new DeterminismError({ api: "Date", use: "a frame count from the tick msg" });
    },
    get(target, property) {
      if (property === "now") {
        return () => {
          throw new DeterminismError({ api: "Date.now", use: "a frame count from the tick msg" });
        };
      }
      return Reflect.get(target, property);
    },
  });

  Math.random = () => {
    throw new DeterminismError({ api: "Math.random", use: "u.random() in init/update" });
  };
  Date.now = () => {
    throw new DeterminismError({ api: "Date.now", use: "a frame count from the tick msg" });
  };
  performance.now = () => {
    throw new DeterminismError({ api: "performance.now", use: "a frame count from the tick msg" });
  };
  globalThis.Date = guardedDate;

  try {
    return body();
  } finally {
    Math.random = realRandom;
    Date.now = realDateNow;
    performance.now = realPerfNow;
    globalThis.Date = realDate;
  }
}


class TeaRunner {
  #options: TeaRunOptions;
  #recorder: FrameRecorder;
  #surface: Surface;
  #util: TeaUtil<ParamsDecl>;
  #view: TeaView;
  #eventsByFrame: Map<number, TeaScriptEvent[]>;
  #params: ParamValues<ParamsDecl>;
  #model: unknown = undefined;
  #mouseX = 0;
  #mouseY = 0;
  // Per-dispatch engagement accumulator: reset before each interaction fold,
  // read after. TeaUtil.handled pushes here via injected
  // callbacks — the runtime owns it; the capability objects never see it.
  #handledNames: string[] = [];
  #unhandled = new UnhandledFold();
  #activity: ActivityReporter;
  #timer: FrameTimer | undefined;
  #score = new Score();

  constructor(options: TeaRunOptions) {
    this.#options = options;
    this.#params = initialParams(options.module.params, options.initialParams);
    this.#recorder = new FrameRecorder({
      frames: options.frames,
      every: options.every,
      ...(options.zooms === undefined ? {} : { zooms: options.zooms }),
      readPixels: () => this.#surface.readPixels(),
    });
    const onHandled = (name: string): void => {
      this.#handledNames.push(name);
    };
    const size = options.module.canvas ?? DEFAULT_CANVAS;
    this.#surface = new Surface({ ...size, host: this.#recorder, seed: options.seed, outline: options.outline === true });
    if (options.timing === true) this.#timer = new FrameTimer();
    this.#util = new TeaUtil({ surface: this.#surface, getParams: () => this.#params, onHandled });
    this.#view = new TeaView({ surface: this.#surface, decl: options.module.params, getParams: () => this.#params });
    this.#eventsByFrame = bucketTeaByFrame(options.events);
    this.#activity = new ActivityReporter(options.module.activity, (message) => this.#recorder.recordLog({ level: "warn", message }));
  }

  run(): RunResult {
    const restoreConsole = patchConsole(this.#recorder);
    try {
      withGuards(() => this.#execute());
      for (const message of this.#unhandled.summary()) this.#recorder.recordLog({ level: "log", message });
      if (this.#timer !== undefined) this.#recorder.recordLog({ level: "log", message: this.#timer.report() });
    } finally {
      restoreConsole();
    }
    return this.#recorder.writeOutput(this.#options.outDir, this.#meta());
  }

  #execute(): void {
    try {
      const initial = this.#options.module.init(this.#util);
      assertSync(initial, "init");
      this.#model = frozenModel(initial);
      for (let frame = 0; frame < this.#options.frames; frame++) {
        this.#runFrame(frame);
      }
      for (const [file, bytes] of soundFiles(this.#score.voices(), { frames: this.#options.frames, fps: this.#options.fps })) {
        this.#recorder.addFile(file, bytes);
      }
    } catch (error) {
      this.#recorder.recordError(error);
    }
  }

  #runFrame(frame: number): void {
    this.#recorder.beginFrame(frame);
    const events = this.#eventsByFrame.get(frame) ?? [];
    this.#recorder.markEvents(events.length > 0);
    for (const event of events) this.#dispatchEvent(event);
    const tick = (): void => void this.#fold({ type: "tick", frame });
    if (this.#timer === undefined) tick();
    else this.#timer.update(frame, tick);
    this.#collectSound(frame);
    const draw = (): unknown => this.#options.module.draw(this.#view, this.#model, this.#params);
    assertSync(this.#timer === undefined ? draw() : this.#timer.draw(frame, draw), "draw");
    this.#surface.finishFrame();
    this.#recorder.captureIfNeeded(frame);
  }

  // After frame N's fold: the voices the model holds join the score.
  #collectSound(frame: number): void {
    const sound = this.#options.module.sound;
    if (sound === undefined) return;
    for (const voice of this.#score.add(sound(this.#model, this.#params), frame)) {
      const pitch = voiceDetail(voice);
      const when = voice.at === frame ? "" : ` at frame ${voice.at}`;
      this.#recorder.recordLog({ level: "log", message: `sound ${voice.kind} "${voice.id}"${pitch}${when}` });
    }
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
        this.#recordActivity();
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
    const text = verdict({ handled: this.#handledNames, changed });
    if (this.#unhandled.show(msg.type, text)) this.#recorder.recordInput({ event: describeInput(msg), verdict: text });
    if (this.#handledNames.length > 0) this.#recordActivity();
  }

  /** The sketch's `activity(model)` after an action, as a transcript line (what a host would receive). */
  #recordActivity(): void {
    const data = this.#activity.of(this.#model);
    if (data !== undefined) this.#recorder.recordLog({ level: "log", message: `activity ${JSON.stringify(data)}` });
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
      width: this.#surface.width,
      height: this.#surface.height,
    };
  }
}

/** Run a TEA-tier sketch module through the deterministic fold loop and write out/. */
export function teaRun(options: TeaRunOptions): RunResult {
  return new TeaRunner(options).run();
}
