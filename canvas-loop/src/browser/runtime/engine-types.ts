// The browser runtime's data types: what it is built from and what it reports.
import type { ControlBox, ParamsDecl, ParamValues, Voice } from "../../core/tea.js";
import type { TextMeasure } from "../../core/text/measure.js";
import type { TeaScriptEvent } from "../../headless/tea-events.js";
import type { PlaygroundModule } from "../sketch-types.js";

import type { ParamOverrides } from "../param-validate.js";

export type { ParamOverrides };

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
 * A param change or a handled input also carries `activity` when the sketch
 * exports `activity(model)` (core/activity.ts).
 * Hosts render the verdict however they like; the on-disk events log
 * (`eventsJSON`) stays the clean `TeaScriptEvent` shape.
 */
export type EmittedEvent = TeaScriptEvent & { handled?: readonly string[]; changed?: boolean; activity?: Record<string, unknown> };

/**
 * What draws a frame for the runtime: the scene surface records the frame and
 * draws it on the GPU.
 */
export interface DrawSurface {
  /** The text measuring `u.textWidth` and `u.textBounds` answer with. */
  readonly textMeasure: TextMeasure;
  /** Fonts changed (a web font loaded): measure text afresh. */
  forgetTextWidths(): void;
  /** Call the sketch's `draw` once; returns where `v.control` placed param inputs. */
  draw(model: unknown, params: ParamValues<ParamsDecl>): ReadonlyMap<string, ControlBox>;
}

/** The surface, made once the runtime exists; `log` is the runtime's frame-tagged log. */
export interface SurfaceDeps {
  surface: (log: (args: readonly unknown[]) => void) => DrawSurface;
}

export type RuntimeDeps = SurfaceDeps & {
  module: PlaygroundModule;
  seed: number;
  onFrame: (frame: number) => void;
  /** A voice whose frame has come (default: the runtime's own `SoundPlayer` plays it). */
  onVoice?: (voice: Voice) => void;
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
  /** After each draw: where `v.control` placed param inputs this frame. */
  onPlace?: (placements: ReadonlyMap<string, ControlBox>) => void;
}
