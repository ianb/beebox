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

type MountSketch = CanvasLoopLib["mountSketch"];

/** A figure entry's `renderer` export does not match the mount its factory calls. */
export class FigureRendererMismatchError extends Error {
  constructor(options: { detail: string }) {
    super(options.detail);
    this.name = "FigureRendererMismatchError";
  }
}

/**
 * Check the entry's `renderer` export against the mount call: `"scene"` must
 * call `mountSceneSketch`; no export must call `mountSketch` (today's
 * figures); any other value is wrong. `bbx figure run` picks its runner from
 * the same export, so a mismatch would draw differently there.
 */
export function rendererMismatch(renderer: unknown, call: "mountSketch" | "mountSceneSketch"): string | null {
  if (renderer !== undefined && renderer !== "scene") return `figure entry: export const renderer must be "scene" or absent; got ${JSON.stringify(renderer)}`;
  if (renderer === "scene" && call === "mountSketch") return 'figure entry: renderer is "scene" but the factory calls cl.mountSketch; call cl.mountSceneSketch';
  if (renderer === undefined && call === "mountSceneSketch") return 'figure entry: the factory calls cl.mountSceneSketch but the entry does not export renderer = "scene"';
  return null;
}

/**
 * `mountSceneSketch` for a figure whose `draw` takes the scene View (canvas-loop
 * scene spike, GPU). The renderer loads on the first call, as its own chunk, so
 * Canvas2D figures never fetch it; the teardown works before it arrives. A
 * failed load goes to the sketch's `onError` and the host's, unless the figure
 * was already torn down.
 */
function sceneMount(hostError: ((message: string) => void) | undefined): MountSketch {
  return (mount, opts) => {
    const state: { torn: boolean; teardown?: () => void } = { torn: false };
    import("@ianbicking/canvas-loop/scene-browser")
      .then((scene) => {
        if (!state.torn) state.teardown = scene.mountSceneSketch(mount, opts);
      })
      .catch((error: unknown) => {
        if (state.torn) return;
        opts.onError?.(error);
        const message = `loading the scene renderer failed: ${error instanceof Error ? error.message : String(error)}`;
        if (hostError === undefined) console.error(`canvas-loop: ${message}`);
        else hostError(message);
      });
    return () => {
      state.torn = true;
      state.teardown?.();
    };
  };
}

/**
 * Return `lib` with its `mountSketch` wrapped for this figure (see the module
 * comment), plus `mountSceneSketch`, wrapped the same way. Each refuses a call
 * that disagrees with the entry's `renderer` export (`rendererMismatch`).
 */
export function wrapCanvasLoopLib<L extends Pick<CanvasLoopLib, "mountSketch">>(lib: L, harness: {
  declared: readonly FigureParamDecl[];
  /** Logs the figure's actions (`useCardActivityReporter`); absent means none. */
  report?: ReportActivity;
  /** The entry module's `renderer` export (absent for today's figures). */
  renderer?: unknown;
  /** The host's error path (the card's figure error); absent: the console. */
  onError?: (message: string) => void;
}): L & { mountSceneSketch: MountSketch } {
  const warned = new Set<string>();
  const { report } = harness;
  const wrap = (inner: MountSketch, call: "mountSketch" | "mountSceneSketch"): MountSketch => (mount, opts) => {
    const mismatch = rendererMismatch(harness.renderer, call);
    if (mismatch !== null) throw new FigureRendererMismatchError({ detail: mismatch });
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
    return inner(mount, {
      ...opts,
      ...(onEvent !== undefined ? { onEvent } : {}),
    });
  };
  return { ...lib, mountSketch: wrap(lib.mountSketch, "mountSketch"), mountSceneSketch: wrap(sceneMount(harness.onError), "mountSceneSketch") };
}
