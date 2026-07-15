// The browser TEA runner — the interactive twin of src/tea-runtime.ts. It folds
// the same sketch contract (init/update/draw) over a real canvas: a fixed-
// timestep rAF loop supplies virtual time as `tick` msgs (frame-count based, NOT
// wall time), pointer/key/param/trigger inputs are queued and dispatched before
// each frame's tick (the frame-N guarantee), the model is deep-frozen between
// frames (dev parity with the headless freeze), and every input is recorded as a
// {frame, …} entry in the exact events-file format — so a session recorded here
// replays byte-for-byte through the CLI.
import { SeededRandom } from "../src/core/prng.js";
import { UnhandledMsgError } from "../src/headless/errors.js";
import type { Msg, ParamsDecl, ParamValues } from "../src/core/tea.js";
import type { TeaScriptEvent } from "../src/headless/tea-events.js";
import { BrowserUtil } from "./browser-util.js";
import { BrowserView } from "./browser-view.js";
import { sanitizeParamChange } from "./param-validate.js";
import type { PlaygroundModule } from "./sketch-types.js";

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

/** A partial override of declared param defaults, applied at construct/restart. */
export type ParamOverrides = Readonly<Record<string, number | boolean | string>>;

function initialParams(decl: ParamsDecl, overrides: ParamOverrides | undefined): ParamValues<ParamsDecl> {
  const values: Record<string, number | boolean | string> = {};
  for (const [name, param] of Object.entries(decl)) {
    if (param.type === "trigger") continue;
    const override = overrides?.[name];
    values[name] = override ?? param.default;
  }
  return Object.freeze(values);
}

/** A frame-tagged log line surfaced to the transcript panel. */
export interface RuntimeLog {
  frame: number;
  message: string;
}

/**
 * A streamed event carries the same engagement verdict the headless transcript
 * shows, as structured data rather than a rendered string: `handled` (the names
 * `u.handled(...)` acknowledged) and `changed` (did `update` return a new model
 * reference). Both are present on interaction events (mouse/key/trigger), absent
 * on `param` (a param change is definitionally applied — no separate verdict).
 * Hosts render the verdict however they like; the on-disk events log
 * (`eventsJSON`) stays the clean `TeaScriptEvent` shape.
 */
export type EmittedEvent = TeaScriptEvent & { handled?: readonly string[]; changed?: boolean };

export interface RuntimeDeps {
  module: PlaygroundModule;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  seed: number;
  onFrame: (frame: number) => void;
  onLog: (entry: RuntimeLog) => void;
  /** Partial override of declared param defaults — the initial values init() sees. */
  initialParams?: ParamOverrides;
  /** Streams every recorded input entry (the `{frame, type, …}` events-file line, plus the engagement verdict) as it is dispatched. */
  onEvent?: (entry: EmittedEvent) => void;
  /**
   * Called once if a frame (update/draw) throws: the loop stops and the error
   * surfaces here instead of throwing uncaught on every subsequent rAF tick.
   * Default when omitted: `console.error` (still exactly once).
   */
  onError?: (error: unknown) => void;
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
  #onLog: (entry: RuntimeLog) => void;
  #onEvent: ((entry: EmittedEvent) => void) | undefined;
  #onError: ((error: unknown) => void) | undefined;
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
    this.#onLog = deps.onLog;
    this.#onEvent = deps.onEvent;
    this.#onError = deps.onError;
    this.#util = new BrowserUtil({
      random: this.#random,
      getParams: () => this.#params,
      log: (args) => this.#recordLog(args),
      onHandled: (name) => this.#handledNames.push(name),
    });
    this.#view = new BrowserView({ ctx: deps.ctx, width: deps.width, height: deps.height, log: (args) => this.#recordLog(args) });
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
  }

  setPaused(paused: boolean): void {
    this.#paused = paused;
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
    this.#frame += 1;
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
  }

  #recordLog(args: readonly unknown[]): void {
    this.#onLog({ frame: this.#frame, message: args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") });
  }
}
