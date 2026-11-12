// The browser TEA runner — the interactive twin of src/tea-runtime.ts. It folds
// the same sketch contract (init/update/draw) over a real canvas: a fixed-
// timestep rAF loop supplies virtual time as `tick` msgs (frame-count based, NOT
// wall time), pointer/key/param/trigger inputs are queued and dispatched before
// each frame's tick (the frame-N guarantee), the model is deep-frozen between
// frames (dev parity with the headless freeze), and every input is recorded as a
// {frame, …} entry in the exact events-file format — so a session recorded here
// replays byte-for-byte through the CLI.
import { SeededRandom } from "../../core/prng.js";
import { UnhandledMsgError } from "../../headless/errors.js";
import type { Voice, ControlBox, Msg, ParamsDecl, ParamValues } from "../../core/tea.js";
import { Score } from "../../core/sound/voice.js";
import { SoundPlayer } from "./sound-player.js";
import type { TeaScriptEvent } from "../../headless/tea-events.js";
import { BrowserUtil } from "./browser-util.js";
import { BrowserView } from "./browser-view.js";
import { initialParams, sanitizeParamChange } from "../param-validate.js";
import type { PlaygroundModule } from "../sketch-types.js";
import type { ParamOverrides, RuntimeDeps } from "./engine-types.js";
import type { EmittedEvent, RuntimeLog } from "./engine-types.js";

export type { EmittedEvent, ParamOverrides, RuntimeDeps, RuntimeLog } from "./engine-types.js";

const STEP_MS = 1000 / 60;
const MAX_STEPS_PER_FRAME = 5;
const MAX_DT_MS = 250;

// A queued input before it is stamped with the frame it dispatches on. `snapshot`
// is a scripted-only directive (a forced capture, never live UI input), so it is
// excluded from the browser's intent stream and its recorded event log.
type InputIntent<T> = T extends unknown ? Omit<T, "frame"> : never;
type Intent = InputIntent<Exclude<TeaScriptEvent, { type: "snapshot" }>>;

function deepFreeze(value: unknown, seen: WeakSet<object>): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  // eslint-disable-next-line no-restricted-syntax -- parse boundary: Object.values on an opaque Model returns any[]
  for (const child of Object.values(value) as unknown[]) deepFreeze(child, seen);
  Object.freeze(value);
}

function frozen(value: unknown): unknown {
  deepFreeze(value, new WeakSet());
  return value;
}


export class Runtime {
  #module: PlaygroundModule;
  #decl: ParamsDecl;
  #view: BrowserView;
  #util: BrowserUtil<ParamsDecl>;
  #random: SeededRandom;
  #seed: number;
  #params: ParamValues<ParamsDecl>;
  #model: unknown = undefined;
  #pending: Intent[] = [];
  #log: TeaScriptEvent[] = [];
  #frame = 0;
  #mouseX = 0;
  #mouseY = 0;
  #paused = false;
  #raf: number | undefined;
  #acc = 0;
  #last: number | undefined;
  #onFrame: (frame: number) => void;
  #onVoice: ((voice: Voice) => void) | undefined;
  // Plays the sketch's voices, when it has a `sound` export.
  #player: SoundPlayer | undefined;
  #score = new Score();
  // Voices declared ahead of their `at` frame, waiting for it.
  #waiting: Voice[] = [];
  #onLog: (entry: RuntimeLog) => void;
  #onEvent: ((entry: EmittedEvent) => void) | undefined;
  #onError: ((error: unknown) => void) | undefined;
  #onPlace: ((placements: ReadonlyMap<string, ControlBox>) => void) | undefined;
  #errored = false;
  #overrides: ParamOverrides | undefined;
  // Per-event engagement accumulator (mirrors the headless runners); reset
  // before each interaction fold, read after. BrowserUtil.handled pushes here.
  #handledNames: string[] = [];

  constructor(deps: RuntimeDeps) {
    this.#module = deps.module;
    this.#decl = deps.module.params ?? {};
    this.#seed = deps.seed;
    this.#random = new SeededRandom(deps.seed);
    this.#overrides = deps.initialParams;
    this.#params = initialParams(this.#decl, this.#overrides);
    this.#onFrame = deps.onFrame;
    this.#player = deps.module.sound === undefined ? undefined : new SoundPlayer((message) => console.info(message));
    this.#onVoice = deps.onVoice ?? ((voice) => this.#player?.play(voice));
    this.#onLog = deps.onLog;
    this.#onEvent = deps.onEvent;
    this.#onError = deps.onError;
    this.#onPlace = deps.onPlace;
    this.#util = new BrowserUtil({
      random: this.#random,
      getParams: () => this.#params,
      log: (args) => this.#recordLog(args),
      onHandled: (name) => this.#handledNames.push(name),
    });
    this.#view = new BrowserView({ ctx: deps.ctx, width: deps.width, height: deps.height, pixelRatio: deps.pixelRatio ?? 1, log: (args) => this.#recordLog(args), params: new Set(Object.keys(this.#decl)) });
    this.#model = frozen(this.#module.init(this.#util));
    this.#draw();
  }

  // ── lifecycle ────────────────────────────────────────────────────
  start(): void {
    if (this.#raf !== undefined) return;
    this.#last = undefined;
    this.#raf = requestAnimationFrame((now) => this.#loop(now));
  }

  stop(): void {
    if (this.#raf !== undefined) cancelAnimationFrame(this.#raf);
    this.#raf = undefined;
    this.#player?.close();
  }

  /** Allow sound; call from a user gesture's handler (browsers start audio only then). */
  enableSound(): void {
    this.#player?.enable();
  }

  setPaused(paused: boolean): void {
    this.#paused = paused;
    // Resume from now, not from when the loop last ran.
    if (!paused) this.#last = undefined;
  }

  get paused(): boolean {
    return this.#paused;
  }

  /** Reseed and re-run from frame 0, clearing the recorded event log. */
  restart(seed: number): void {
    this.#seed = seed;
    this.#random = new SeededRandom(seed);
    this.#util = new BrowserUtil({
      random: this.#random,
      getParams: () => this.#params,
      log: (args) => this.#recordLog(args),
      onHandled: (name) => this.#handledNames.push(name),
    });
    this.#params = initialParams(this.#decl, this.#overrides);
    this.#pending = [];
    this.#log = [];
    this.#frame = 0;
    this.#acc = 0;
    this.#last = undefined;
    this.#score.clear();
    this.#waiting = [];
    this.#player?.stopAll();
    this.#model = frozen(this.#module.init(this.#util));
    this.#onFrame(this.#frame);
    this.#draw();
  }

  get seed(): number {
    return this.#seed;
  }

  // ── input (the one path controls and pointer/key listeners share) ─
  setParam(name: string, value: number | boolean | string): void {
    // The single choke point for every live param mutation (widget edits,
    // controlled host dispatch, scripted events all land here): validate +
    // coerce against the declaration, dropping an unknown/mismatched value and
    // clamping an out-of-range number — the same `checkParam` initial overrides use.
    const coerced = sanitizeParamChange({ decl: this.#decl, name, value });
    if (coerced === undefined) return;
    this.#pending.push({ type: "param", name, value: coerced });
  }

  trigger(name: string): void {
    this.#pending.push({ type: "trigger", name });
  }

  pointer(ev: { type: "mousedown" | "mouseup" | "mousemove"; x: number; y: number }): void {
    this.#pending.push({ type: ev.type, x: ev.x, y: ev.y });
  }

  key(ev: { type: "keydown" | "keyup"; key: string }): void {
    this.#pending.push({ type: ev.type, key: ev.key });
  }

  // ── recorded output ──────────────────────────────────────────────
  eventsJSON(): string {
    return JSON.stringify(this.#log, null, 2);
  }

  eventCount(): number {
    return this.#log.length;
  }

  paramValues(): ParamValues<ParamsDecl> {
    return this.#params;
  }

  // ── loop internals ───────────────────────────────────────────────
  #loop(now: number): void {
    // Reschedule up front so a slow frame doesn't drop the loop — but that means
    // a throwing update/draw would otherwise recur uncaught every tick forever.
    // Guard the whole frame: on a throw, stop (cancelling the just-scheduled rAF)
    // and surface the error exactly once.
    this.#raf = requestAnimationFrame((next) => this.#loop(next));
    try {
      this.#step(now);
    } catch (error) {
      this.stop();
      this.#reportError(error);
    }
  }

  #step(now: number): void {
    const last = this.#last ?? now;
    this.#last = now;
    if (this.#paused) {
      if (this.#pending.length > 0) {
        this.#flushPending();
        this.#draw();
      }
      return;
    }
    let dt = now - last;
    if (dt > MAX_DT_MS) dt = STEP_MS;
    this.#acc += dt;
    let steps = 0;
    while (this.#acc >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      this.#doFrame();
      this.#acc -= STEP_MS;
      steps += 1;
    }
    if (steps > 0) {
      this.#draw();
      this.#onFrame(this.#frame);
    }
  }

  #reportError(error: unknown): void {
    if (this.#errored) return;
    this.#errored = true;
    if (this.#onError !== undefined) this.#onError(error);
    else console.error("canvas-loop: sketch frame threw; loop stopped", error);
  }

  #doFrame(): void {
    this.#flushPending();
    this.#fold({ type: "tick", frame: this.#frame });
    this.#collectSound();
    this.#frame += 1;
  }

  // After a fold, as headless does: new voices join the score; any whose frame
  // has come start now, the rest wait for it.
  #collectSound(): void {
    const sound = this.#module.sound;
    if (sound === undefined) return;
    const frame = this.#frame;
    this.#waiting.push(...this.#score.add(sound(this.#model, this.#params), frame));
    const due = this.#waiting.filter((voice) => voice.at <= frame);
    if (due.length === 0) return;
    this.#waiting = this.#waiting.filter((voice) => voice.at > frame);
    for (const voice of due) this.#onVoice?.(voice);
  }

  #flushPending(): void {
    if (this.#pending.length === 0) return;
    const intents = this.#pending;
    this.#pending = [];
    for (const intent of intents) {
      const entry: TeaScriptEvent = { frame: this.#frame, ...intent };
      this.#log.push(entry);
      const emitted = this.#foldIntent(entry, intent);
      // Fire after the fold so a `param` entry's value is already applied to
      // `#params` — a watcher reading `paramValues()` sees the new value.
      this.#onEvent?.(emitted);
    }
  }

  // Fold one queued intent and return the entry to stream. A `param` keeps its
  // clean shape (definitionally applied, no verdict); every interaction carries
  // the engagement verdict (accumulated `handled` names + model-reference change).
  #foldIntent(entry: TeaScriptEvent, intent: Intent): EmittedEvent {
    if (intent.type === "param") {
      this.#fold(this.#toMsg(intent));
      return entry;
    }
    this.#handledNames = [];
    const changed = this.#fold(this.#toMsg(intent));
    return { ...entry, handled: [...this.#handledNames], changed };
  }

  #toMsg(intent: Intent): Msg {
    switch (intent.type) {
      case "mousedown":
      case "mouseup":
      case "mousemove": {
        if (intent.x !== undefined) this.#mouseX = intent.x;
        if (intent.y !== undefined) this.#mouseY = intent.y;
        return { type: intent.type, x: this.#mouseX, y: this.#mouseY };
      }
      case "keydown":
      case "keyup":
        return { type: intent.type, key: intent.key ?? "" };
      case "param":
        this.#params = Object.freeze({ ...this.#params, [intent.name]: intent.value });
        return { type: "param", name: intent.name, value: intent.value };
      case "trigger":
        return { type: "trigger", name: intent.name };
    }
  }

  #fold(msg: Msg): boolean {
    const next = this.#module.update(this.#model, msg, this.#util);
    // A box sketch (no lint) whose update switch omits a Msg case returns
    // undefined here; without this guard the model silently becomes undefined
    // and draw crashes downstream with a confusing error. Fail loud, naming the
    // unhandled msg.type so the author knows which case to add.
    if (next === undefined) throw new UnhandledMsgError({ msgType: msg.type });
    // Reference-change is the free engagement signal — compute before freezing
    // (frozen() returns the same reference it froze, so it must run first).
    const changed = next !== this.#model;
    this.#model = frozen(next);
    return changed;
  }

  #draw(): void {
    this.#module.draw(this.#view, this.#model, this.#params);
    this.#view.finishFrame();
    const placements = this.#view.takePlacements();
    this.#onPlace?.(placements);
  }

  #recordLog(args: readonly unknown[]): void {
    this.#onLog({ frame: this.#frame, message: args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") });
  }
}
