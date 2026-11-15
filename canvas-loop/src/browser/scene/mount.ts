// `mountSceneSketch(mount, options)`: today's `mountSketch` for a sketch whose
// `draw` takes the draft View. The same fixed-step runtime, input wiring,
// over-canvas controls, panel and transport; each frame is recorded and drawn
// through the GPU renderer into a WebGPU canvas. Off screen the figure sleeps:
// the loop stops at once, and after two seconds every GPU texture and kept
// value is freed, while the model, params, frame counter and last record stay.
// Waking after a release draws that record again without calling `draw`, then
// resumes (draft sections 8 and 20). There is no
// Canvas2D fallback: without WebGPU the figure reports a `SceneMountError`.
import type { ControlBox } from "../../core/tea.js";
import { buildControls, ControlOverlay } from "../controls.js";
import type { MountSketchOptions } from "../mount.js";
import { buildTransport, coerceModule, DEFAULT_CANVAS, pixelRatioOf, sizeCanvas, wireInput } from "../mount.js";
import { sanitizeInitialParams } from "../param-validate.js";
import { Runtime, watchVisibility } from "../runtime/engine.js";
import type { PlaygroundModule } from "../sketch-types.js";
import { browserTextMeasurer } from "../../device/browser.js";
import { leaseGpu } from "./shared-gpu.js";
import { FigureSleep } from "./sleep.js";
import { SceneSurface } from "./surface.js";

const DEFAULT_SEED = 42;

/** A running scene figure, for test pages and dev tools. */
export interface SceneFigure {
  readonly runtime: Runtime;
  readonly surface: SceneSurface;
  /** The runtime's frame counter. */
  frame(): number;
  /** What the visibility watcher calls. On screen, resolves once the figure draws again (at once within the release delay). */
  setOnScreen(onScreen: boolean): Promise<void>;
  readonly sleep: FigureSleep;
}

/** Options for {@link mountSceneSketch}: today's `mountSketch` options, plus a handle for test pages. */
export interface MountSceneSketchOptions extends MountSketchOptions {
  /** Called once the figure runs (after the GPU device opens), with its handle. */
  inspect?: (figure: SceneFigure) => void;
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
function buildNotice(stage: HTMLElement, onRetry: () => void): { show: (message: string) => void; hide: () => void } {
  const notice = document.createElement("button");
  notice.type = "button";
  notice.className = "cl-error";
  Object.assign(notice.style, { position: "absolute", left: "8px", right: "8px", top: "8px", display: "none", cursor: "pointer", textAlign: "left", font: "inherit" });
  notice.addEventListener("click", onRetry);
  stage.append(notice);
  return {
    show: (message) => {
      notice.textContent = message;
      notice.style.display = "";
    },
    hide: () => {
      notice.style.display = "none";
    },
  };
}

interface Started {
  readonly figure: SceneFigure;
  readonly teardown: () => void;
  /** A terminal error: stop, and free the GPU resources (idempotent). */
  readonly fail: () => void;
}

/** Undo steps for a partly built figure, run newest first; each runs once. */
class Rollback {
  readonly #steps: (() => void)[] = [];

  add(step: () => void): void {
    this.#steps.push(step);
  }

  run(): void {
    for (const step of this.#steps.splice(0).toReversed()) {
      try {
        step();
      } catch (error) {
        console.error("canvas-loop: scene figure teardown step failed", error);
      }
    }
  }
}

/** Build the runtime, controls, sleep and watchers on an opened surface; on a throw, everything built so far is undone. */
function start(a: { module: PlaygroundModule; opts: MountSceneSketchOptions; shell: Shell; surface: SceneSurface; report: (error: unknown) => void; notice: ReturnType<typeof buildNotice> }): Started {
  const { module, opts, shell, surface, report } = a;
  const decl = module.params ?? {};
  const size = module.canvas ?? DEFAULT_CANVAS;
  const live: { runtime?: Runtime } = {};
  const undo = new Rollback();
  let placed: ReadonlyMap<string, ControlBox> = new Map();
  let frameNow = 0;
  let excluded: ReadonlySet<string> = new Set();
  let renderPanel = (): void => {};
  // A control's change is a user gesture: it may unlock sound (iOS needs one), as in today's mount.
  const onParam = (name: string, value: number | boolean | string): void => {
    live.runtime?.enableSound();
    live.runtime?.setParam(name, value);
  };
  const onTrigger = (name: string): void => {
    live.runtime?.enableSound();
    live.runtime?.trigger(name);
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
  undo.add(() => overlay.remove());
  undo.add(() => void surface.destroy());
  try {
    const initialParams = sanitizeInitialParams({ decl, overrides: opts.initialParams });
    const rt = new Runtime({
      module,
      seed: opts.seed ?? DEFAULT_SEED,
      surface: (log) => surface.bind(log),
      ...(initialParams === undefined ? {} : { initialParams }),
      onFrame: (frame) => {
        frameNow = frame;
        shell.frameLabel.textContent = `frame ${frame}`;
      },
      onLog: (entry) => console.log(`[canvas-loop] frame ${entry.frame}: ${entry.message}`),
      onError: report,
      onPlace: (placements) => {
        placed = placements;
        if (live.runtime !== undefined) overlay.sync(placements, live.runtime.paramValues());
      },
      onEvent: (entry) => {
        opts.onEvent?.(entry);
        if (entry.type === "param" && live.runtime !== undefined) opts.onParamsChange?.(live.runtime.paramValues());
      },
    });
    live.runtime = rt;
    undo.add(() => rt.stop());
    rt.setPaused(!(opts.autoplay ?? true));
    const detachInput = wireInput(shell.canvas, rt);
    undo.add(detachInput);
    const sleep = new FigureSleep({
      suspend: () => rt.suspend(),
      resume: () => rt.resume(),
      release: () => surface.sleep(),
      restore: () => surface.wake(),
      restored: () => surface.state === "awake",
      onRestoreFailed: (error) => a.notice.show(`The figure could not get a GPU device again (${error instanceof Error ? error.message : String(error)}). Click to try again.`),
      onRestored: () => a.notice.hide(),
    });
    undo.add(() => sleep.end());
    surface.onLost = (message: string): void => {
      a.notice.show(message);
      sleep.lost();
    };
    rt.start();
    const detachWatch = watchVisibility(shell.canvas, {
      suspend: () => void sleep.setOnScreen(false),
      resume: () => void sleep.setOnScreen(true),
      // A resized canvas re-places the over-canvas inputs; the picture itself needs no new draw.
      invalidate: () => overlay.sync(placed, rt.paramValues()),
      fontsLoaded: () => rt.fontsLoaded(),
    });
    undo.add(detachWatch);
    const panelHost = document.createElement("div");
    renderPanel = (): void => {
      panelHost.replaceChildren(buildControls({ decl, values: rt.paramValues(), onParam, onTrigger, classPrefix: "cl-", exclude: excluded }));
    };
    if (opts.transport ?? false) shell.container.append(buildTransport({ runtime: rt, frameLabel: shell.frameLabel, renderPanel }));
    if (opts.panel ?? Object.keys(decl).length > 0) {
      renderPanel();
      shell.container.append(panelHost);
    }
    overlay.sync(placed, rt.paramValues());
    return {
      figure: { runtime: rt, surface, setOnScreen: (onScreen) => sleep.setOnScreen(onScreen), frame: () => frameNow, sleep },
      teardown: () => undo.run(),
      fail: () => {
        sleep.end();
        rt.stop();
        void surface.fail();
      },
    };
  } catch (error) {
    undo.run();
    throw error;
  }
}

/**
 * Mount a scene figure into a host element; returns a teardown (idempotent)
 * that stops the loop, frees the GPU resources, detaches listeners and removes
 * everything it added. A bad module throws, as `mountSketch` does; failures
 * after that (no WebGPU, a frame that throws) go to `onError` once, and a
 * failed figure frees its GPU resources while its canvas keeps the last frame.
 */
export function mountSceneSketch(mount: HTMLElement, opts: MountSceneSketchOptions): () => void {
  const module = coerceModule(opts.module);
  const shell = buildShell(module.canvas ?? DEFAULT_CANVAS);
  mount.append(shell.container);
  let torn = false;
  let started: Started | undefined;
  let reported = false;
  const report = (error: unknown): void => {
    started?.fail();
    if (reported) return;
    reported = true;
    if (opts.onError === undefined) console.error("canvas-loop: scene figure failed", error);
    else opts.onError(error);
  };
  let retry = (): void => {};
  const notice = buildNotice(shell.stage, () => retry());
  const run = async (): Promise<void> => {
    const lease = await leaseGpu();
    if (torn) {
      lease.release();
      return;
    }
    let surface: SceneSurface;
    try {
      surface = new SceneSurface({ canvas: shell.canvas, size: module.canvas ?? DEFAULT_CANVAS, ratio: pixelRatioOf(shell.canvas), seed: opts.seed ?? DEFAULT_SEED, decl: module.params ?? {}, draw: module.draw, text: browserTextMeasurer(), lease, onError: report });
    } catch (error) {
      lease.release();
      throw error;
    }
    // `start` undoes its own partial work (surface included) before rethrowing.
    started = start({ module, opts, shell, surface, report, notice });
    const { figure } = started;
    retry = (): void => void figure.setOnScreen(true);
    opts.inspect?.(figure);
  };
  run().catch(report);
  return () => {
    if (torn) return;
    torn = true;
    started?.teardown();
    shell.container.remove();
  };
}
