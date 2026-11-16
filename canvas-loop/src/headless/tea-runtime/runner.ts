// The one headless runner: a TEA sketch run for N frames through the
// deterministic fold loop, its captured frames rendered and written with a
// transcript. Each frame is recorded as a scene and rendered by the GPU
// renderer on Dawn (headless/scene/surface.ts). Each sketch call runs under the determinism
// guards; the render between them is awaited outside them.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CliError, UnhandledMsgError } from "../errors.js";
import { assertSync, deepFreeze, guardParams, startParams, withGuards } from "./guards.js";
import { ActivityReporter } from "../../core/activity.js";
import { SeededRandom } from "../../core/prng.js";
import { FrameRecorder, patchConsole } from "../recorder/frame-recorder.js";
import type { Zoom } from "../recorder/zoom.js";
import { FrameTimer } from "../recorder/timing.js";
import type { RunResult } from "../recorder/frame-recorder.js";
import { Score, voiceDetail } from "../../core/sound/voice.js";
import { soundFiles } from "../recorder/sound.js";
import { UnhandledFold, describeInput, verdict } from "../../core/engagement.js";
import type { InteractionMsg } from "../../core/engagement.js";
import { bucketTeaByFrame } from "../tea-events.js";
import type { TeaScriptEvent } from "../tea-events.js";
import { TeaUtil } from "../tea-util.js";
import { renderTranscript } from "../transcript.js";
import type { RunMeta } from "../transcript.js";
import type { CanvasSize, Msg, ParamsDecl, ParamValues } from "../../core/tea.js";
import { formatArgs } from "../../core/format.js";
import type { FrameSurface } from "../frame-surface.js";
import type { GpuHandle } from "../../device/open.js";
import { NoGpuAdapterError } from "../../scene/errors.js";
// Type-only: the loader owns LoadedTeaModule (see tea-load.ts for why it
// lives there and not here).
import type { LoadedTeaModule } from "../tea-load.js";

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
  /** Add a timing summary line to the transcript (`--timing`); the scene renderer adds its counts per captured frame. */
  timing?: boolean;
  /** Outline debug boxes, controls, clips and placed pictures over each frame (`--outline`). */
  outline?: boolean;
  events: readonly TeaScriptEvent[];
  eventsPath: string | undefined;
  /** Start params other than the declared defaults (checked against the declaration). */
  initialParams?: Readonly<Record<string, number | boolean | string>>;
  /** Scene renderer: device pixels per canvas pixel (`--ratio`, default 1). */
  ratio?: number;
  /** Scene renderer: write each captured frame's scene outline (true), only the first one's ("first"), or none (`--scene`). */
  scene?: boolean | "first";
  /** Scene renderer, tests: open the GPU device another way. Default: the process's one device. */
  openGpu?: () => Promise<GpuHandle | undefined>;
}

/** A run is in progress in this process (its guards and console capture are process-wide). */
let running = false;

// A scripted INTERACTION event: everything but snapshot (a forced capture) and
// param (which keeps its own `param:` line). These earn an engagement verdict.
type TeaInputEvent = Exclude<TeaScriptEvent, { type: "snapshot" } | { type: "param" }>;

/** The step running, for the error line: the frame (undefined before frame 0) and init, update, sound, draw or render. */
interface Step {
  frame: number | undefined;
  name: string;
}

class TeaRunner {
  #options: TeaRunOptions;
  #recorder: FrameRecorder;
  #surface: FrameSurface;
  #util: TeaUtil<ParamsDecl>;
  #eventsByFrame: Map<number, TeaScriptEvent[]>;
  /** The params now; the surface reads them live (controls), and a param event replaces them. */
  #state: { params: ParamValues<ParamsDecl> };
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
  #step: Step = { frame: undefined, name: "init" };

  constructor(options: TeaRunOptions, a: { recorder: FrameRecorder; state: { params: ParamValues<ParamsDecl> }; surface: FrameSurface }) {
    this.#options = options;
    this.#recorder = a.recorder;
    this.#state = a.state;
    this.#surface = a.surface;
    if (options.timing === true) this.#timer = new FrameTimer();
    this.#util = new TeaUtil({
      random: new SeededRandom(options.seed),
      getParams: () => this.#state.params,
      onHandled: (name) => void this.#handledNames.push(name),
      log: (args) => this.#recorder.recordLog({ level: "log", message: formatArgs(args) }),
      text: a.surface.text,
    });
    this.#eventsByFrame = bucketTeaByFrame(options.events);
    this.#activity = new ActivityReporter(options.module.activity, (message) => this.#recorder.recordLog({ level: "warn", message }));
  }

  async run(): Promise<RunResult> {
    let restoreConsole: (() => void) | undefined;
    try {
      // Console output during the run (the sketch's console.log) goes to its transcript.
      restoreConsole = patchConsole(this.#recorder);
      await this.#execute();
      for (const message of this.#unhandled.summary()) this.#recorder.recordLog({ level: "log", message });
      if (this.#timer !== undefined) this.#recorder.recordLog({ level: "log", message: this.#timer.report() });
    } finally {
      restoreConsole?.();
      this.#surface.close();
    }
    return this.#recorder.writeOutput(this.#options.outDir, runMeta(this.#options, this.#surface.adapter));
  }

  async #execute(): Promise<void> {
    try {
      this.#model = this.#sketch("init", () => this.#options.module.init(this.#util));
      for (let frame = 0; frame < this.#options.frames; frame++) {
        await this.#runFrame(frame);
      }
      this.#surface.finish();
      for (const [file, bytes] of soundFiles(this.#score.voices(), { frames: this.#options.frames, fps: this.#options.fps })) {
        this.#recorder.addFile(file, bytes);
      }
    } catch (error) {
      this.#recorder.recordError({ frame: this.#step.frame, step: this.#step.name, error });
    }
  }

  /**
   * Call a sketch function under the guards; its result must not be a
   * Promise. `init`'s, `update`'s and `sound`'s results are frozen, under the
   * guards too, so a getter they run is guarded.
   */
  #sketch<T>(name: "init" | "update" | "sound" | "draw", call: () => T): T {
    return withGuards(() => {
      const result = call();
      assertSync(result, name);
      if (name !== "draw") deepFreeze(result);
      return result;
    });
  }

  async #runFrame(frame: number): Promise<void> {
    this.#recorder.beginFrame(frame);
    this.#step = { frame, name: "update" };
    const events = this.#eventsByFrame.get(frame) ?? [];
    this.#recorder.markEvents(events.length > 0);
    for (const event of events) this.#dispatchEvent(event);
    const tick = (): void => void this.#fold({ type: "tick", frame });
    if (this.#timer === undefined) tick();
    else this.#timer.update(frame, tick);
    this.#step = { frame, name: "sound" };
    this.#collectSound(frame);
    this.#step = { frame, name: "draw" };
    const { module } = this.#options;
    const model = this.#model;
    const params = this.#state.params;
    const draw = (): void => this.#surface.draw((v) => void this.#sketch("draw", (): unknown => Reflect.apply(module.draw, undefined, [v, model, params])));
    if (this.#timer === undefined) draw();
    else this.#timer.draw(frame, draw);
    if (!this.#recorder.shouldCapture(frame)) return;
    // Only captured frames are rendered.
    this.#step = { frame, name: "render" };
    const capture = await this.#surface.capture();
    this.#recorder.capture(frame, capture.pixels);
    for (const message of capture.lines) this.#recorder.recordLog({ level: "log", message });
    if (capture.block !== undefined) this.#recorder.recordBlock(capture.block);
  }

  // After frame N's fold: the voices the model holds join the score.
  #collectSound(frame: number): void {
    const sound = this.#options.module.sound;
    if (sound === undefined) return;
    const model = this.#model;
    const params = this.#state.params;
    for (const voice of this.#score.add(this.#sketch("sound", () => sound(model, params)), frame)) {
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
        this.#state.params = guardParams(this.#options.module.params, { ...this.#state.params, [event.name]: event.value });
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
    const model = this.#model;
    const json = withGuards(() => this.#activity.json(model));
    if (json !== undefined) this.#recorder.recordLog({ level: "log", message: `activity ${json}` });
  }

  #fold(msg: Msg): boolean {
    const model = this.#model;
    const next = this.#sketch("update", () => this.#options.module.update(model, msg, this.#util));
    // A box sketch (no lint) whose update switch omits a Msg case returns
    // undefined here; without this guard the model silently becomes undefined
    // and draw crashes downstream with a confusing error. Fail loud, naming the
    // unhandled msg.type so the author knows which case to add.
    if (next === undefined) throw new UnhandledMsgError({ msgType: msg.type });
    // Reference-change is the free engagement signal (freezing keeps the reference).
    const changed = next !== model;
    this.#model = next;
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
}

function runMeta(options: TeaRunOptions, adapter: string | undefined): RunMeta {
  const size = options.module.canvas ?? DEFAULT_CANVAS;
  return {
    sketchPath: options.sketchPath,
    seed: options.seed,
    fps: options.fps,
    frames: options.frames,
    eventsPath: options.eventsPath,
    width: size.width,
    height: size.height,
    ratio: options.ratio ?? 1,
    ...(adapter === undefined ? {} : { adapter }),
  };
}

/** The scene surface; undefined when Dawn finds no GPU adapter. */
async function openSurface(options: TeaRunOptions, a: { recorder: FrameRecorder; getParams: () => ParamValues<ParamsDecl> }): Promise<FrameSurface | undefined> {
  const { module } = options;
  const size = module.canvas ?? DEFAULT_CANVAS;
  const common = { ...size, host: a.recorder, decl: module.params, getParams: a.getParams, outline: options.outline === true };
  // Loaded only here: the scene surface opens Dawn, a native module (`webgpu`).
  const { openSceneSurface } = await import("../scene/surface.js");
  return openSceneSurface({
    ...common,
    seed: options.seed,
    ratio: options.ratio ?? 1,
    scene: options.scene ?? false,
    timing: options.timing === true,
    ...(options.openGpu === undefined ? {} : { openGpu: options.openGpu }),
  });
}

/** No adapter: write the transcript (its header and the failure line), then throw `NoGpuAdapterError` naming it. */
function noAdapter(options: TeaRunOptions): never {
  const transcriptPath = join(options.outDir, "transcript.md");
  const error = new NoGpuAdapterError({ transcriptPath });
  rmSync(options.outDir, { recursive: true, force: true });
  mkdirSync(options.outDir, { recursive: true });
  writeFileSync(transcriptPath, renderTranscript(runMeta(options, undefined), [{ kind: "error", frame: undefined, step: "setup", text: `${error.name}: ${error.message}`, at: [] }]));
  throw error;
}

/**
 * Run a TEA sketch module through the deterministic fold loop and write out/.
 * A step that throws ends the run: its line is in the transcript and in
 * `RunResult.errors`. Throws for bad options (a starting param the sketch
 * would not show) and, after writing the transcript, `NoGpuAdapterError`.
 */
export async function teaRun(options: TeaRunOptions): Promise<RunResult> {
  if (running) throw new CliError({ detail: "teaRun is already running in this process: a run captures the process's console until it ends, so runs go one at a time (await the first, or use a child process)" });
  running = true;
  try {
    const { module } = options;
    const state = { params: guardParams(module.params, startParams(module.params, options.initialParams ?? {})) };
    const ratio = options.ratio ?? 1;
    const recorder = new FrameRecorder({ frames: options.frames, every: options.every, ratio, ...(options.zooms === undefined ? {} : { zooms: options.zooms }) });
    const surface = await openSurface(options, { recorder, getParams: () => state.params });
    if (surface === undefined) noAdapter(options);
    return await new TeaRunner(options, { recorder, state, surface }).run();
  } finally {
    running = false;
  }
}
