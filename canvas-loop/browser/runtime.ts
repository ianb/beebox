// The browser TEA runner — the interactive twin of src/tea-runtime.ts. It folds
// the same sketch contract (init/update/draw) over a real canvas: a fixed-
// timestep rAF loop supplies virtual time as `tick` msgs (frame-count based, NOT
// wall time), pointer/key/param/trigger inputs are queued and dispatched before
// each frame's tick (the frame-N guarantee), the model is deep-frozen between
// frames (dev parity with the headless freeze), and every input is recorded as a
// {frame, …} entry in the exact events-file format — so a session recorded here
// replays byte-for-byte through the CLI.
import { SeededRandom } from "../src/prng.js";
import type { Msg, ParamsDecl, ParamValues } from "../src/tea.js";
import type { TeaScriptEvent } from "../src/tea-events.js";
import { BrowserUtil } from "./browser-util.js";
import { BrowserView } from "./browser-view.js";
import type { PlaygroundModule } from "./sketch-types.js";

const STEP_MS = 1000 / 60;
const MAX_STEPS_PER_FRAME = 5;
const MAX_DT_MS = 250;

// A queued input before it is stamped with the frame it dispatches on.
type InputIntent<T> = T extends unknown ? Omit<T, "frame"> : never;
type Intent = InputIntent<TeaScriptEvent>;

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

function initialParams(decl: ParamsDecl): ParamValues<ParamsDecl> {
  const values: Record<string, number | boolean | string> = {};
  for (const [name, param] of Object.entries(decl)) {
    if (param.type === "trigger") continue;
    values[name] = param.default;
  }
  return Object.freeze(values);
}

/** A frame-tagged log line surfaced to the transcript panel. */
export interface RuntimeLog {
  frame: number;
  message: string;
}

export interface RuntimeDeps {
  module: PlaygroundModule;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  seed: number;
  onFrame: (frame: number) => void;
  onLog: (entry: RuntimeLog) => void;
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

  constructor(deps: RuntimeDeps) {
    this.#module = deps.module;
    this.#decl = deps.module.params ?? {};
    this.#seed = deps.seed;
    this.#random = new SeededRandom(deps.seed);
    this.#params = initialParams(this.#decl);
    this.#onFrame = deps.onFrame;
    this.#onLog = deps.onLog;
    this.#util = new BrowserUtil({
      random: this.#random,
      getParams: () => this.#params,
      log: (args) => this.#recordLog(args),
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
    });
    this.#params = initialParams(this.#decl);
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
    this.#pending.push({ type: "param", name, value });
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
    this.#raf = requestAnimationFrame((next) => this.#loop(next));
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
      this.#log.push({ frame: this.#frame, ...intent });
      this.#fold(this.#toMsg(intent));
    }
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

  #fold(msg: Msg): void {
    this.#model = frozen(this.#module.update(this.#model, msg, this.#util));
  }

  #draw(): void {
    this.#module.draw(this.#view, this.#model, this.#params);
  }

  #recordLog(args: readonly unknown[]): void {
    this.#onLog({ frame: this.#frame, message: args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") });
  }
}
