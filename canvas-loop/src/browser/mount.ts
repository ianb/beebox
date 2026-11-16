// The imperative browser figure API — the `@ianbicking/canvas-loop/browser`
// subpath. `mountSketch(mount, opts)` builds a complete figure (canvas +
// optional transport toolbar + optional declaration-generated param panel)
// inside a host element and returns a teardown; `attachSketch(canvas, opts)`
// is the shared lower layer (runtime, scene surface, input wiring, sleep and
// teardown on a given canvas) that both `mountSketch` and the React
// `<SketchFigure>` delegate to — one implementation of the lifecycle.
//
// Figures draw with WebGPU. The GPU code (`scene/figure.ts`, the renderer) is
// loaded on the first attach, and the device opens asynchronously: the figure
// draws when both are ready (`AttachedSketch.ready`). Without WebGPU a figure
// reports `NoWebGpuError`, without an adapter `NoGpuAdapterError`, through
// `onError`, once.
//
// No React, no @napi-rs/canvas anywhere in this module's import graph (the
// dependency-isolation test enforces it), and NO runtime <style> injection —
// hosts with a strict CSP import the stylesheet instead:
//
//   import "@ianbicking/canvas-loop/browser/figure.css";
import type { CanvasSize, ControlBox } from "../core/tea.js";
import { toTeaModule } from "../headless/tea-load.js";
import { SketchMountError } from "../scene/errors.js";
import { buildControls, ControlOverlay } from "./controls.js";
import type { Runtime, EmittedEvent, ParamOverrides, RuntimeLog } from "./runtime/engine.js";
import type { FigureGpu, SceneFigure, StartedFigure } from "./scene/figure/start.js";
import type { PlaygroundModule } from "./sketch-types.js";
import { pixelRatioOf, sizeCanvas, wireInput } from "./canvas-dom.js";

export { pixelRatioOf, setDensity, sizeCanvas, wireInput } from "./canvas-dom.js";

// Re-exported so `./browser` consumers can type an `onEvent` handler that reads
// the engagement verdict fields.
export type { EmittedEvent } from "./runtime/engine.js";
export type { FigureGpu, SceneFigure } from "./scene/figure/start.js";
// The errors a host matches on, by class.
export { NoGpuAdapterError, NoWebGpuError, RemovedCallError, SketchMountError } from "../scene/errors.js";

// Re-exported here so the public `./browser` subpath keeps exporting it (the
// definition lives in param-validate.ts, shared with Runtime.setParam).
export { sanitizeInitialParams } from "./param-validate.js";

/** Default drawing surface when a sketch declares no `canvas`. */
export const DEFAULT_CANVAS: CanvasSize = { width: 400, height: 300 };

const DEFAULT_SEED = 42;

/** Options for {@link attachSketch} — the runtime-on-a-canvas layer. */
export interface AttachSketchOptions {
  module: PlaygroundModule;
  seed: number;
  /** Start paused (renders frame 0 and waits). */
  paused: boolean;
  /**
   * Partial override of declared param defaults. Validated here (the single
   * enforcement point both `mountSketch` and `<SketchFigure>` share): an unknown
   * name or type-mismatched/non-finite value warns and falls back to the
   * default; an out-of-range number is clamped.
   */
  initialParams?: ParamOverrides;
  onFrame: (frame: number) => void;
  /** Streams each recorded input entry as it is dispatched. */
  onEvent?: (entry: EmittedEvent) => void;
  /**
   * Called once if the figure fails: no WebGPU (`NoWebGpuError`), no adapter
   * (`NoGpuAdapterError`), a canvas without a WebGPU context
   * (`SketchMountError`), a frame that throws (a removed call is a
   * `RemovedCallError`), or a GPU fault. The loop stops and the GPU resources
   * are freed. Default: `console.error`.
   */
  onError?: (error: unknown) => void;
  /** After each draw: where `v.control` placed param inputs this frame. */
  onPlace?: (placements: ReadonlyMap<string, ControlBox>) => void;
  /** The log (`v.log`, warnings, replay verdicts), frame-tagged. Default: the console. */
  onLog?: (entry: RuntimeLog) => void;
  /** The device was lost (`message`; the figure redraws when it next comes into view), or `undefined` once it draws again. Default: `console.warn`. */
  onNotice?: (message: string | undefined) => void;
  /** Called once the figure runs, with its handle (test pages, dev tools). */
  inspect?: (figure: SceneFigure) => void;
  /** Where the figure gets its device (tests and dev tools); default the page's shared WebGPU device. */
  gpu?: FigureGpu;
}

export interface AttachedSketch {
  /** The runtime, once `ready` resolved; undefined before. */
  readonly runtime: Runtime | undefined;
  /** Resolves with the runtime once the device opened and frame 0 is on screen. Never settles if the figure fails first (see `onError`) or is torn down first. */
  readonly ready: Promise<Runtime>;
  /** Stops the loop, detaches input listeners and frees the GPU resources; before `ready`, releases the device lease. Idempotent. */
  teardown: () => void;
}

/**
 * Start a figure on an existing canvas element: open the GPU device, then
 * build the runtime and the scene surface and wire pointer/key input into it.
 * The caller owns the element — its width/height attributes should be the
 * module's declared `canvas` size times the pixel ratio (`sizeCanvas`).
 */
export function attachSketch(canvas: HTMLCanvasElement, opts: AttachSketchOptions): AttachedSketch {
  const state: { torn: boolean; reported: boolean; started: StartedFigure | undefined; runtime: Runtime | undefined; detachInput: (() => void) | undefined; stopBuilding: (() => void) | undefined } = { torn: false, reported: false, started: undefined, runtime: undefined, detachInput: undefined, stopBuilding: undefined };
  // The host hears one failure; `report` also stops the figure, `inform` leaves it retryable (a device not recreated yet).
  const inform = (error: unknown): void => {
    if (state.reported || state.torn) return;
    state.reported = true;
    if (opts.onError === undefined) console.error("canvas-loop: figure failed", error);
    else opts.onError(error);
  };
  const report = (error: unknown): void => {
    state.started?.fail();
    inform(error);
  };
  let resolveReady: (runtime: Runtime) => void = () => {};
  const ready = new Promise<Runtime>((resolve) => {
    resolveReady = resolve;
  });
  // Read through a function: teardown can run while `run` awaits, which narrowing does not see.
  const torn = (): boolean => state.torn;
  const run = async (): Promise<void> => {
    const { startFigure } = await import("./scene/figure/start.js");
    if (state.torn) return;
    const size = opts.module.canvas ?? DEFAULT_CANVAS;
    const started = await startFigure(canvas, {
      opts: { ...opts, size, ratio: pixelRatioOf(canvas) },
      report,
      inform,
      torn,
      building: (stop) => {
        state.stopBuilding = stop;
      },
    });
    state.stopBuilding = undefined;
    if (started === undefined) return;
    // Torn down while it started (a callback during frame 0, or before this continuation ran).
    if (torn()) {
      started.teardown();
      return;
    }
    state.started = started;
    const { runtime } = started.figure;
    // Input after the runtime exists; a throw here undoes the figure.
    try {
      state.detachInput = wireInput(canvas, runtime);
    } catch (error) {
      started.teardown();
      state.started = undefined;
      throw error;
    }
    state.runtime = runtime;
    opts.inspect?.(started.figure);
    if (!torn()) resolveReady(runtime);
  };
  run().catch(report);
  return {
    get runtime(): Runtime | undefined {
      return state.runtime;
    },
    ready,
    teardown: () => {
      if (state.torn) return;
      state.torn = true;
      state.detachInput?.();
      state.stopBuilding?.();
      state.started?.teardown();
      state.runtime = undefined;
    },
  };
}

/** Options for {@link mountSketch}. */
export interface MountSketchOptions {
  /**
   * The TEA sketch module: an object with `init`/`update`/`draw` (+ optional
   * `params`, `canvas`). Untrusted — validated against the TEA contract; an
   * invalid value throws a typed error (CliError from the shared validator,
   * SketchMountError for a non-object).
   */
  module: unknown;
  /** PRNG seed. Default 42. */
  seed?: number;
  /** Start the rAF loop immediately. Default true; false renders a paused frame 0. */
  autoplay?: boolean;
  /** Show the declaration-generated param panel. Default: true iff the module declares params. */
  panel?: boolean;
  /** Show the play/pause + restart toolbar. Default false — embeds are frameless. */
  transport?: boolean;
  /**
   * Partial override of declared param defaults. Validated against the
   * module's declaration: an unknown name or a type-mismatched value warns
   * (console.warn) and is ignored, falling back to the declared default.
   */
  initialParams?: ParamOverrides;
  /** Reports the applied param values after each change (host persistence hook). */
  onParamsChange?: (values: ParamOverrides) => void;
  /** Streams each recorded input entry (the events-file line). */
  onEvent?: (entry: EmittedEvent) => void;
  /** Called once if the figure fails (see `AttachSketchOptions.onError`). Default: `console.error`. */
  onError?: (error: unknown) => void;
  /** Called once the figure runs, with its handle (test pages, dev tools). */
  inspect?: (figure: SceneFigure) => void;
  /** Where the figure gets its device (tests and dev tools); default the page's shared WebGPU device. */
  gpu?: FigureGpu;
}

/** The DOM a figure is built in; made at once, so the figure takes its space while the device opens. */
interface Shell {
  readonly container: HTMLElement;
  readonly stage: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly frameLabel: HTMLElement;
}

function buildShell(size: { width: number; height: number }): Shell {
  const container = document.createElement("div");
  container.className = "cl-figure";
  // The stage hugs the canvas so over-canvas inputs (`v.control`) position against it.
  const stage = document.createElement("div");
  stage.className = "cl-stage";
  stage.style.position = "relative";
  const canvas = document.createElement("canvas");
  canvas.className = "cl-canvas";
  sizeCanvas(canvas, size);
  canvas.tabIndex = 0;
  stage.append(canvas);
  container.append(stage);
  const frameLabel = document.createElement("span");
  frameLabel.className = "cl-frame";
  frameLabel.textContent = "frame 0";
  return { container, stage, canvas, frameLabel };
}

/** A notice over the canvas (a lost device); clicking it tries to draw again. */
function buildNotice(stage: HTMLElement, onRetry: () => void): (message: string | undefined) => void {
  const notice = document.createElement("button");
  notice.type = "button";
  notice.className = "cl-error";
  Object.assign(notice.style, { position: "absolute", left: "8px", right: "8px", top: "8px", display: "none", cursor: "pointer", textAlign: "left", font: "inherit" });
  notice.addEventListener("click", onRetry);
  stage.append(notice);
  return (message) => {
    if (message === undefined) {
      notice.style.display = "none";
      return;
    }
    notice.textContent = `${message} Click to try again.`;
    notice.style.display = "";
  };
}

/**
 * Mount a complete figure into a host element; returns a teardown (idempotent)
 * that stops the loop, frees the GPU resources, detaches listeners and removes
 * everything it added. A bad module throws; failures after that go to
 * `onError` once. The panel and transport appear once the figure runs.
 */
export function mountSketch(mount: HTMLElement, opts: MountSketchOptions): () => void {
  const module = coerceModule(opts.module);
  const decl = module.params ?? {};
  const size = module.canvas ?? DEFAULT_CANVAS;
  const shell = buildShell(size);
  // Over-canvas inputs. The first draw runs before `ready`, so the latest placements are kept and synced after.
  let placed: ReadonlyMap<string, ControlBox> = new Map();
  let excluded: ReadonlySet<string> = new Set();
  let renderPanel = (): void => {};
  let figure: SceneFigure | undefined;
  // A control's change is a user gesture: it may unlock sound (iOS needs one).
  const onParam = (name: string, value: number | boolean | string): void => {
    attached.runtime?.enableSound();
    attached.runtime?.setParam(name, value);
  };
  const onTrigger = (name: string): void => {
    attached.runtime?.enableSound();
    attached.runtime?.trigger(name);
  };
  const overlay = new ControlOverlay({
    stage: shell.stage,
    size,
    decl,
    handlers: { onParam, onTrigger },
    onShownChange: (names) => {
      excluded = names;
      renderPanel();
    },
  });
  const notice = buildNotice(shell.stage, () => void figure?.setOnScreen(true));
  mount.append(shell.container);
  const attached = attachSketch(shell.canvas, {
    module,
    seed: opts.seed ?? DEFAULT_SEED,
    paused: !(opts.autoplay ?? true),
    ...(opts.initialParams === undefined ? {} : { initialParams: opts.initialParams }),
    ...(opts.onError === undefined ? {} : { onError: opts.onError }),
    ...(opts.gpu === undefined ? {} : { gpu: opts.gpu }),
    onNotice: notice,
    inspect: (f) => {
      figure = f;
      opts.inspect?.(f);
    },
    onFrame: (frame) => {
      shell.frameLabel.textContent = `frame ${frame}`;
    },
    onPlace: (placements) => {
      placed = placements;
      const rt = attached.runtime;
      if (rt !== undefined) overlay.sync(placements, rt.paramValues());
    },
    onEvent: (entry) => {
      opts.onEvent?.(entry);
      const rt = attached.runtime;
      if (entry.type === "param" && rt !== undefined) opts.onParamsChange?.(rt.paramValues());
    },
  });
  const panelHost = document.createElement("div");
  let torn = false;
  attached.ready
    .then((rt) => {
      if (torn) return;
      renderPanel = (): void => {
        panelHost.replaceChildren(buildControls({ decl, values: rt.paramValues(), onParam, onTrigger, classPrefix: "cl-", exclude: excluded }));
      };
      if (opts.transport ?? false) shell.container.append(buildTransport({ runtime: rt, frameLabel: shell.frameLabel, renderPanel }));
      if (opts.panel ?? Object.keys(decl).length > 0) {
        renderPanel();
        shell.container.append(panelHost);
      }
      // After insertion, so the stage has its shown width for scaling input text.
      overlay.sync(placed, rt.paramValues());
    })
    .catch((error: unknown) => {
      // Building the panel failed: the figure stops, and the host hears it once.
      attached.teardown();
      if (opts.onError === undefined) console.error("canvas-loop: figure failed", error);
      else opts.onError(error);
    });
  return () => {
    if (torn) return;
    torn = true;
    attached.teardown();
    overlay.remove();
    shell.container.remove();
  };
}

/** The transport toolbar: frame readout + play/pause + restart. */
export function buildTransport(deps: { runtime: Runtime; frameLabel: HTMLElement; renderPanel: () => void }): HTMLElement {
  const { runtime } = deps;
  const toolbar = document.createElement("div");
  toolbar.className = "cl-toolbar";
  const playPause = document.createElement("button");
  playPause.type = "button";
  playPause.className = "cl-btn";
  playPause.textContent = runtime.paused ? "Play" : "Pause";
  playPause.addEventListener("click", () => {
    runtime.setPaused(!runtime.paused);
    playPause.textContent = runtime.paused ? "Play" : "Pause";
  });
  const restart = document.createElement("button");
  restart.type = "button";
  restart.className = "cl-btn";
  restart.textContent = "Restart";
  restart.addEventListener("click", () => {
    runtime.restart(runtime.seed);
    deps.renderPanel();
  });
  toolbar.append(deps.frameLabel, playPause, restart);
  return toolbar;
}

// Local, deliberately minimal record guard (the loader keeps its own private
// copy; a shared generic guard has no natural home in this package).
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Validate an untrusted module value against the TEA contract. */
export function coerceModule(raw: unknown): PlaygroundModule {
  if (!isRecord(raw)) {
    throw new SketchMountError({ detail: "module must be a TEA sketch module object (named exports: init, update, draw)" });
  }
  const loaded = toTeaModule(raw);
  return {
    params: loaded.params,
    // Omit an undeclared canvas — PlaygroundModule is exactOptionalPropertyTypes.
    ...(loaded.canvas !== undefined ? { canvas: loaded.canvas } : {}),
    init: loaded.init,
    update: loaded.update,
    draw: loaded.draw,
    ...(loaded.sound === undefined ? {} : { sound: loaded.sound }),
    ...(loaded.activity === undefined ? {} : { activity: loaded.activity }),
  };
}
