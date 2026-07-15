// The imperative browser figure API — the `@ianbicking/canvas-loop/browser`
// subpath. `mountSketch(mount, opts)` builds a complete figure (canvas +
// optional transport toolbar + optional declaration-generated param panel)
// inside a host element and returns a teardown; `attachSketch(canvas, opts)`
// is the shared lower layer (runtime creation + input wiring + teardown) that
// both `mountSketch` and the React `<SketchFigure>` delegate to — one
// implementation of the mount/wire/stop lifecycle.
//
// No React, no @napi-rs/canvas anywhere in this module's import graph (the
// dependency-isolation test enforces it), and NO runtime <style> injection —
// hosts with a strict CSP import the stylesheet instead:
//
//   import "@ianbicking/canvas-loop/browser/figure.css";
import type { CanvasSize, ParamDecl, ParamsDecl } from "../src/core/tea.js";
import type { TeaScriptEvent } from "../src/headless/tea-events.js";
import { toTeaModule } from "../src/headless/tea-load.js";
import { buildControls } from "./controls.js";
import { Runtime, type ParamOverrides } from "./runtime.js";
import type { PlaygroundModule } from "./sketch-types.js";

/** Default drawing surface when a sketch declares no `canvas`. */
export const DEFAULT_CANVAS: CanvasSize = { width: 400, height: 300 };

const DEFAULT_SEED = 42;

/** Thrown when `mountSketch` can't mount: bad module value or no 2D context. */
export class SketchMountError extends Error {
  name = "SketchMountError";
  constructor(options: { detail: string }) {
    super(`mountSketch: ${options.detail}`);
  }
}

/** Options for {@link attachSketch} — the runtime-on-a-canvas layer. */
export interface AttachSketchOptions {
  module: PlaygroundModule;
  seed: number;
  /** Start paused (renders frame 0 and waits). */
  paused: boolean;
  /** Partial override of declared param defaults (pre-validated by callers). */
  initialParams?: ParamOverrides;
  onFrame: (frame: number) => void;
  /** Streams each recorded input entry as it is dispatched. */
  onEvent?: (entry: TeaScriptEvent) => void;
}

export interface AttachedSketch {
  runtime: Runtime;
  /** Detaches input listeners and stops the rAF loop. */
  teardown: () => void;
}

/**
 * Create a runtime on an existing canvas element and wire pointer/key input
 * into it. Returns null when the canvas has no 2D context (canvas already in
 * use with another context kind). The caller owns the element — its
 * width/height attributes should match the module's declared `canvas` size.
 */
export function attachSketch(canvas: HTMLCanvasElement, opts: AttachSketchOptions): AttachedSketch | null {
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;
  const size = opts.module.canvas ?? DEFAULT_CANVAS;
  const runtime = new Runtime({
    module: opts.module,
    ctx,
    width: size.width,
    height: size.height,
    seed: opts.seed,
    // Omit rather than pass `undefined` — RuntimeDeps is exactOptionalPropertyTypes.
    ...(opts.initialParams !== undefined ? { initialParams: opts.initialParams } : {}),
    onFrame: opts.onFrame,
    onLog: () => {
      // Figures surface frames + recorded events, not the transcript log.
    },
    ...(opts.onEvent !== undefined ? { onEvent: opts.onEvent } : {}),
  });
  runtime.setPaused(opts.paused);
  runtime.start();
  const detachInput = wireInput(canvas, runtime);
  return {
    runtime,
    teardown: () => {
      detachInput();
      runtime.stop();
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
  onEvent?: (entry: TeaScriptEvent) => void;
}

/**
 * Mount a complete figure into a host element; returns a teardown that stops
 * the loop, detaches listeners, and removes everything it added.
 */
export function mountSketch(mount: HTMLElement, opts: MountSketchOptions): () => void {
  const module = coerceModule(opts.module);
  const decl = module.params ?? {};
  const seed = opts.seed ?? DEFAULT_SEED;
  const size = module.canvas ?? DEFAULT_CANVAS;
  const showPanel = opts.panel ?? Object.keys(decl).length > 0;
  const showTransport = opts.transport ?? false;

  const container = document.createElement("div");
  container.className = "cl-figure";
  const canvas = document.createElement("canvas");
  canvas.className = "cl-canvas";
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.tabIndex = 0;
  container.append(canvas);

  const frameLabel = document.createElement("span");
  frameLabel.className = "cl-frame";
  frameLabel.textContent = "frame 0";

  // `attached` is assigned right below; runtime callbacks only fire from rAF
  // frames and control events, never synchronously during attachSketch.
  let attached: AttachedSketch | null = null;
  const initialParams = sanitizeInitialParams({ decl, overrides: opts.initialParams });
  attached = attachSketch(canvas, {
    module,
    seed,
    paused: !(opts.autoplay ?? true),
    ...(initialParams !== undefined ? { initialParams } : {}),
    onFrame: (frame) => {
      frameLabel.textContent = `frame ${frame}`;
    },
    onEvent: (entry) => {
      opts.onEvent?.(entry);
      if (entry.type === "param" && attached !== null) {
        opts.onParamsChange?.(attached.runtime.paramValues());
      }
    },
  });
  if (attached === null) {
    throw new SketchMountError({ detail: "canvas has no 2D context" });
  }
  const runtime = attached.runtime;

  // The panel is rebuilt after a restart so widgets show the re-applied
  // initial values (widget edits keep themselves in sync; restart doesn't).
  const panelHost = document.createElement("div");
  const renderPanel = (): void => {
    panelHost.replaceChildren(
      buildControls({
        decl,
        values: runtime.paramValues(),
        onParam: (name, value) => runtime.setParam(name, value),
        onTrigger: (name) => runtime.trigger(name),
        classPrefix: "cl-",
      }),
    );
  };

  if (showTransport) container.append(buildTransport({ runtime, frameLabel, renderPanel }));
  if (showPanel) {
    renderPanel();
    container.append(panelHost);
  }
  mount.append(container);

  return () => {
    attached?.teardown();
    container.remove();
  };
}

/** The transport toolbar: frame readout + play/pause + restart. */
function buildTransport(deps: { runtime: Runtime; frameLabel: HTMLElement; renderPanel: () => void }): HTMLElement {
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
function coerceModule(raw: unknown): PlaygroundModule {
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
  };
}

/** True when a supplied override value fits the declared param's type. */
function matchesDecl(param: ParamDecl, value: number | boolean | string): boolean {
  switch (param.type) {
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "select":
      return typeof value === "string" && param.options.includes(value);
    case "trigger":
      return false;
  }
}

/**
 * Validate initial-param overrides against the module's declaration: an
 * unknown name, a trigger, or a type-mismatched value (e.g. a string feeding
 * a number param, a select value outside its options) warns and is dropped —
 * the declared default applies instead. Net-new over the runtime's own
 * handling, which silently ignores unknown names and never type-checks.
 */
export function sanitizeInitialParams(deps: {
  decl: ParamsDecl;
  overrides: ParamOverrides | undefined;
}): ParamOverrides | undefined {
  const { decl, overrides } = deps;
  if (overrides === undefined) return undefined;
  const out: Record<string, number | boolean | string> = {};
  for (const [name, value] of Object.entries(overrides)) {
    const param = decl[name];
    if (param === undefined) {
      console.warn(`canvas-loop: ignoring initial param "${name}" — the sketch declares no such param`);
      continue;
    }
    if (!matchesDecl(param, value)) {
      console.warn(
        `canvas-loop: ignoring initial param "${name}" — ${JSON.stringify(value)} does not fit the declared ${param.type} param; using its default`,
      );
      continue;
    }
    out[name] = value;
  }
  return out;
}

/**
 * Wire pointer/key listeners on the canvas straight into the runtime's input
 * methods — the same dispatch path scripted events take. Returns a teardown
 * that removes every listener, so cleanup leaves nothing behind.
 */
export function wireInput(canvas: HTMLCanvasElement, runtime: Runtime): () => void {
  let pressed = false;
  const onDown = (e: MouseEvent): void => {
    pressed = true;
    canvas.focus();
    const p = coords(canvas, e);
    runtime.pointer({ type: "mousedown", x: p.x, y: p.y });
  };
  const onMove = (e: MouseEvent): void => {
    if (!pressed) return;
    const p = coords(canvas, e);
    runtime.pointer({ type: "mousemove", x: p.x, y: p.y });
  };
  const release = (e: MouseEvent): void => {
    if (!pressed) return;
    pressed = false;
    const p = coords(canvas, e);
    runtime.pointer({ type: "mouseup", x: p.x, y: p.y });
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (e.key.startsWith("Arrow")) e.preventDefault();
    runtime.key({ type: "keydown", key: e.key });
  };
  const onKeyUp = (e: KeyboardEvent): void => runtime.key({ type: "keyup", key: e.key });
  canvas.addEventListener("mousedown", onDown);
  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("mouseup", release);
  canvas.addEventListener("mouseleave", release);
  canvas.addEventListener("keydown", onKeyDown);
  canvas.addEventListener("keyup", onKeyUp);
  return () => {
    canvas.removeEventListener("mousedown", onDown);
    canvas.removeEventListener("mousemove", onMove);
    canvas.removeEventListener("mouseup", release);
    canvas.removeEventListener("mouseleave", release);
    canvas.removeEventListener("keydown", onKeyDown);
    canvas.removeEventListener("keyup", onKeyUp);
  };
}

/** CSS→canvas coordinate mapping for a pointer event (accounts for display scaling). */
function coords(canvas: HTMLCanvasElement, e: MouseEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const sx = rect.width === 0 ? 1 : canvas.width / rect.width;
  const sy = rect.height === 0 ? 1 : canvas.height / rect.height;
  return { x: Math.round((e.clientX - rect.left) * sx), y: Math.round((e.clientY - rect.top) * sy) };
}
