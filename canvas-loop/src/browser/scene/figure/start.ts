// The GPU half of `attachSketch`, loaded on the first mount as its own chunk:
// lease the page's device, make the scene surface on the figure's canvas, and
// build the fixed-step runtime, input wiring and sleep on it. Each frame is
// recorded and drawn through the GPU renderer. Off screen the figure sleeps:
// the loop stops at once, and after two seconds every GPU texture and kept
// value is freed, while the model, params, frame counter and last record stay.
// Waking after a release draws that record again without calling `draw`, then
// resumes. There is no Canvas2D fallback.
import type { ControlBox } from "../../../core/tea.js";
import type { TextMeasurer } from "../../../core/text/measure.js";
import { browser2d, browserTextMeasurer } from "../../../device/browser.js";
import { colorsFrom } from "../../../scene/colors.js";
import type { ColorParser } from "../../../scene/colors.js";
import { sanitizeInitialParams } from "../../param-validate.js";
import { Runtime } from "../../runtime/engine.js";
import { watchVisibility } from "./visibility.js";
import type { EmittedEvent, ParamOverrides, RuntimeLog } from "../../runtime/engine.js";
import type { PlaygroundModule } from "../../sketch-types.js";
import { leaseGpu } from "../shared-gpu.js";
import type { GpuLease, LeaseGpu } from "../shared-gpu.js";
import { GpuRenderError } from "../../../scene/errors.js";
import { FigureSleep } from "./sleep.js";
import { SceneSurface } from "../surface.js";
import type { SceneSurfaceDeps } from "../surface.js";

/** Where a figure gets its device, text measuring and colour parsing. Default: the page's shared WebGPU device and the browser's 2D context. Tests and dev tools pass stand-ins. */
export interface FigureGpu {
  readonly lease?: LeaseGpu;
  readonly text?: TextMeasurer;
  readonly colors?: ColorParser;
  readonly makeRenderer?: SceneSurfaceDeps["makeRenderer"];
}

/** A running figure, for test pages and dev tools. */
export interface SceneFigure {
  readonly runtime: Runtime;
  readonly surface: SceneSurface;
  /** The runtime's frame counter. */
  frame(): number;
  /** What the visibility watcher calls. On screen, resolves once the figure draws again (at once within the release delay). */
  setOnScreen(onScreen: boolean): Promise<void>;
  readonly sleep: FigureSleep;
}

/** What the figure needs from `attachSketch`'s options. */
export interface FigureOptions {
  readonly module: PlaygroundModule;
  readonly seed: number;
  readonly paused: boolean;
  /** The canvas in logical pixels, and device pixels per logical pixel. */
  readonly size: { width: number; height: number };
  readonly ratio: number;
  readonly initialParams?: ParamOverrides;
  readonly onFrame: (frame: number) => void;
  readonly onEvent?: (entry: EmittedEvent) => void;
  readonly onPlace?: (placements: ReadonlyMap<string, ControlBox>) => void;
  readonly onLog?: (entry: RuntimeLog) => void;
  /** The device was lost (`message`), or drawing again failed; `undefined` once the figure draws again. */
  readonly onNotice?: (message: string | undefined) => void;
  readonly gpu?: FigureGpu;
}

export interface StartedFigure {
  readonly figure: SceneFigure;
  /** Stop and free everything (idempotent). */
  readonly teardown: () => void;
  /** A terminal error: stop, and free the GPU resources (idempotent); the canvas keeps its last frame. */
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
        console.error("canvas-loop: figure teardown step failed", error);
      }
    }
  }
}

/** The scene surface on `canvas`, with the stand-ins `opts.gpu` gives or the browser's own. */
function openSurface(canvas: HTMLCanvasElement, a: { opts: FigureOptions; lease: GpuLease; report: (error: unknown) => void }): SceneSurface {
  const { opts } = a;
  const gpu = opts.gpu ?? {};
  return new SceneSurface({
    canvas,
    size: opts.size,
    ratio: opts.ratio,
    seed: opts.seed,
    decl: opts.module.params ?? {},
    draw: opts.module.draw,
    text: gpu.text ?? browserTextMeasurer(),
    colors: gpu.colors ?? colorsFrom(browser2d()),
    lease: a.lease,
    onError: a.report,
    ...(gpu.lease === undefined ? {} : { openLease: gpu.lease }),
    ...(gpu.makeRenderer === undefined ? {} : { makeRenderer: gpu.makeRenderer }),
  });
}

/**
 * Lease a device and start the figure on `canvas`; resolves once frame 0 is on
 * screen. Resolves undefined, with everything released, when `torn()` turned
 * true meanwhile or frame 0 failed to draw (already reported). Throws
 * `NoWebGpuError` or `NoGpuAdapterError` without a device, and whatever the
 * sketch's `init` or first `draw` threw; everything built is undone first.
 */
export async function startFigure(canvas: HTMLCanvasElement, a: { opts: FigureOptions; report: (error: unknown) => void; inform: (error: unknown) => void; torn: () => boolean; building: (stop: () => void) => void }): Promise<StartedFigure | undefined> {
  const { opts } = a;
  // A failure while starting (frame 0's draw or present) is reported once, and the start then stops.
  const start = { failed: false };
  const report = (error: unknown): void => {
    start.failed = true;
    a.report(error);
  };
  const { module } = opts;
  const lease = await (opts.gpu?.lease ?? leaseGpu)();
  if (a.torn()) {
    lease.release();
    return undefined;
  }
  let surface: SceneSurface;
  try {
    surface = openSurface(canvas, { opts, lease, report });
  } catch (error) {
    lease.release();
    throw error;
  }
  const undo = new Rollback();
  undo.add(() => void surface.destroy());
  try {
    let frameNow = 0;
    const initialParams = sanitizeInitialParams({ decl: module.params ?? {}, overrides: opts.initialParams });
    const rt = new Runtime({
      module,
      seed: opts.seed,
      surface: (log) => surface.bind(log),
      ...(initialParams === undefined ? {} : { initialParams }),
      onFrame: (frame) => {
        frameNow = frame;
        opts.onFrame(frame);
      },
      // The log (`v.log`, warnings, replay verdicts) goes to the console, frame-tagged.
      onLog: opts.onLog ?? ((entry) => console.log(`[canvas-loop] frame ${entry.frame}: ${entry.message}`)),
      onError: report,
      ...(opts.onPlace === undefined ? {} : { onPlace: opts.onPlace }),
      ...(opts.onEvent === undefined ? {} : { onEvent: opts.onEvent }),
    });
    undo.add(() => rt.stop());
    rt.setPaused(opts.paused);
    const notice = opts.onNotice ?? ((message: string | undefined): void => void (message === undefined ? undefined : console.warn(`canvas-loop: ${message}`)));
    const sleep = new FigureSleep({
      suspend: () => rt.suspend(),
      resume: () => rt.resume(),
      release: () => surface.sleep(),
      restore: () => surface.wake(),
      restored: () => surface.state === "awake",
      // The figure stays retryable (waking again, or the notice), and the host hears it once.
      onRestoreFailed: (error) => {
        notice(`The figure could not get a GPU device again (${error instanceof Error ? error.message : String(error)}).`);
        a.inform(error);
      },
      onRestored: () => notice(undefined),
    });
    undo.add(() => sleep.end());
    surface.onLost = (message: string): void => {
      notice(message);
      sleep.lost();
    };
    rt.start();
    const detachWatch = watchVisibility(canvas, {
      suspend: () => void sleep.setOnScreen(false),
      resume: () => void sleep.setOnScreen(true),
      invalidate: () => rt.invalidate(),
      fontsLoaded: () => rt.fontsLoaded(),
    });
    undo.add(detachWatch);
    // A teardown while frame 0 is still drawing stops everything at once.
    a.building(() => undo.run());
    // Frame 0 on screen before the figure counts as started: a first present that fails was reported, and torn down here.
    await surface.settled();
    if (!a.torn() && !start.failed && surface.state === "lost") report(new GpuRenderError({ detail: "the GPU device was lost before the figure's first frame was drawn" }));
    if (a.torn() || start.failed || surface.state === "failed" || surface.state === "destroyed") {
      undo.run();
      return undefined;
    }
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
