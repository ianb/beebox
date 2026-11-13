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
 *   activity log with the sketch's `activity(model)` value when it has one.
 */

import type * as CanvasLoopBrowser from "@ianbicking/canvas-loop/browser";
import type { EmittedEvent } from "@ianbicking/canvas-loop/browser";
import type { ReportActivity } from "@core/chat/card-activity.js";
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

/** Return `lib` with its `mountSketch` wrapped for this figure (see the module comment). */
export function wrapCanvasLoopLib<L extends Pick<CanvasLoopLib, "mountSketch">>(lib: L, harness: {
  declared: readonly FigureParamDecl[];
  /** Logs the figure's actions (`useCardActivityReporter`); absent means none. */
  report?: ReportActivity;
}): L {
  const warned = new Set<string>();
  const { report } = harness;
  const mountSketch: CanvasLoopLib["mountSketch"] = (mount, opts) => {
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
    return lib.mountSketch(mount, {
      ...opts,
      ...(onEvent !== undefined ? { onEvent } : {}),
    });
  };
  return { ...lib, mountSketch };
}
