/**
 * The beebox side of a canvas-loop figure's `lib.mountSketch(mount, opts)`
 * call (plan `docs/implemented-plans/figure-check.md`). FigureMount hands the sketch a copy
 * of the canvas-loop browser namespace whose `mountSketch`:
 *
 * - console-warns once per card param that the module does not declare, or
 *   declares with a type the card's type cannot map to;
 * - chains the sketch's own `onEvent` and reports learner activity as
 *   `explored`: declared param values and handled names only, never
 *   coordinates, raw keys or model state. Each report also goes to the
 *   activity log with the sketch's `activity(model)` value when it has one;
 * - hands every failure after mount to the card first, then to the sketch's
 *   own `onError`, so the card can show it in the figure's place
 *   (`figureNotice`);
 * - drops the `inspect` and `gpu` options, which hand over or replace the
 *   page's shared GPU device: sketch code builds scenes and never holds the
 *   device (FigureMount also leaves `attachSketch` out of the library).
 */

import type * as CanvasLoopBrowser from "@ianbicking/canvas-loop/browser";
import type { EmittedEvent } from "@ianbicking/canvas-loop/browser";
import type { ReportActivity } from "@core/chat/card-activity.js";
import { errorMessage } from "@shared/error-guards";
import { isRecord } from "@shared/is-record";
import type { FigureParamDecl, FigureParamType } from "./figure-params";

type CanvasLoopLib = typeof CanvasLoopBrowser;

/** Longest activity detail sent; a longer one is cut with an ellipsis. */
const DETAIL_CAP = 200;

/** The canvas-loop declaration types each card param type can map to. */
const MODULE_TYPES_FOR: Record<FigureParamType, readonly string[]> = { string: ["select", "text"], number: ["number"], boolean: ["boolean"] };

/**
 * The activity detail for one recorded input, or null when it says nothing
 * the agent should hear: a param change names the param and its value; any
 * other input counts only when the sketch marked it handled.
 */
export function figureActivityDetail(event: EmittedEvent): string | null {
  let detail: string;
  if (event.type === "param") detail = `set ${event.name} = ${String(event.value)}`;
  else if (event.handled !== undefined && event.handled.length > 0) detail = `pressed ${event.handled.join(", ")}`;
  else return null;
  return detail.length > DETAIL_CAP ? `${detail.slice(0, DETAIL_CAP - 1)}…` : detail;
}

/**
 * One warning per card param the canvas-loop module cannot honor: the module
 * does not declare it, or declares it with a type the card type does not map
 * to. `module` is the sketch's untrusted `opts.module`.
 */
export function paramMismatches(declared: readonly FigureParamDecl[], module: unknown): string[] {
  const moduleParams = isRecord(module) && isRecord(module.params) ? module.params : {};
  const out: string[] = [];
  for (const decl of declared) {
    const entry = moduleParams[decl.name];
    const moduleType = isRecord(entry) && typeof entry.type === "string" ? entry.type : null;
    if (moduleType === null) {
      out.push(`figure params: card param "${decl.name}" is not declared in the canvas-loop module's params`);
    } else if (!MODULE_TYPES_FOR[decl.type].includes(moduleType)) {
      out.push(`figure params: card param "${decl.name}" is ${decl.type}, but the module declares it ${moduleType} (card string→select or text, number→number, boolean→boolean)`);
    }
  }
  return out;
}

type MountSketch = CanvasLoopLib["mountSketch"];

/** Return `lib` with its `mountSketch` wrapped for this figure (see the module comment). */
export function wrapCanvasLoopLib<L extends Pick<CanvasLoopLib, "mountSketch">>(lib: L, harness: {
  declared: readonly FigureParamDecl[];
  /** Logs the figure's actions (`useCardActivityReporter`); absent means none. */
  report?: ReportActivity;
  /** The card's error handler: hears every mount failure, before the sketch's own `onError`. */
  onError: (error: unknown) => void;
}): L {
  const warned = new Set<string>();
  const { report } = harness;
  // Each handler in its own `try`: the host always hears the error, whatever the sketch's callback does.
  const onErrorFor = (sketchOnError: ((error: unknown) => void) | undefined) => (error: unknown) => {
    try {
      harness.onError(error);
    } catch (e) {
      console.error("figure host onError threw", e);
    }
    if (sketchOnError === undefined) return;
    try {
      sketchOnError(error);
    } catch (e) {
      console.error("figure sketch onError threw", e);
    }
  };
  const wrap = (inner: MountSketch): MountSketch => (mount, opts) => {
    for (const warning of paramMismatches(harness.declared, opts.module)) {
      if (warned.has(warning)) continue;
      warned.add(warning);
      console.warn(warning);
    }
    const sketchOnEvent = opts.onEvent;
    const onEvent = report === undefined ? sketchOnEvent : (event: EmittedEvent) => {
      sketchOnEvent?.(event);
      const detail = figureActivityDetail(event);
      if (detail === null) return;
      report("explored", detail, event.activity);
    };
    const { inspect: _inspect, gpu: _gpu, ...sketchOpts } = opts;
    return inner(mount, {
      ...sketchOpts,
      ...(onEvent !== undefined ? { onEvent } : {}),
      onError: onErrorFor(opts.onError),
    });
  };
  return { ...lib, mountSketch: wrap(lib.mountSketch) };
}

/** What the card shows in a figure's place when it cannot draw (canvas-loop box figures plan, C3). */
export interface FigureNotice {
  /** `outdated`: written for the earlier canvas-loop; `no-webgpu`, `no-adapter`: this device cannot draw it; `error`: anything else. */
  kind: "outdated" | "no-webgpu" | "no-adapter" | "error";
  /** The technical line: for `outdated`, `<call> was removed: <replacement>`. */
  detail: string;
}

/**
 * The notice for a figure failure. canvas-loop's errors are matched by
 * `name`, since they come from a lazily loaded chunk; a string is a compile
 * error from the module route.
 */
export function figureNotice(error: unknown): FigureNotice {
  if (typeof error === "string") return { kind: "error", detail: error };
  const name = isRecord(error) && typeof error.name === "string" ? error.name : "";
  if (name === "RemovedCallError" && isRecord(error) && typeof error.call === "string" && typeof error.replacement === "string") {
    return { kind: "outdated", detail: `${error.call} was removed: ${error.replacement}` };
  }
  const detail = errorMessage(error);
  if (name === "NoWebGpuError") return { kind: "no-webgpu", detail };
  if (name === "NoGpuAdapterError") return { kind: "no-adapter", detail };
  return { kind: "error", detail };
}
