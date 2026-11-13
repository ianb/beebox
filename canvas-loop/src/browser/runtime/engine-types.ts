// The browser runtime's data types: what it is built from and what it reports.
import type { ControlBox, Voice } from "../../core/tea.js";
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

export interface RuntimeDeps {
  module: PlaygroundModule;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  /** Device pixels per logical pixel of the canvas (see `sizeCanvas`); 1 when absent. */
  pixelRatio?: number;
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
