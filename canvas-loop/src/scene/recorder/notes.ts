// The recorder's bookkeeping for messages: whether `draw` is running (a View
// kept past `draw` must refuse to record), the frame's identity (a Picture
// handle from another frame is refused by `place`), and testing-mode warnings,
// each naming the sketch's line and given once per run, and performance hints.
import { SketchUsageError } from "../../core/errors.js";
import { atSketchLine } from "../call-site.js";
import type { Mat, PictureVersion } from "../nodes.js";
import { PlacementScales } from "./placement-scales.js";

/** Where a recorder gives each log, warning and hint as it happens. */
export type NoteSink = (note: { kind: "log" | "warn" | "hint"; message: string }) => void;

export class RecorderNotes {
  readonly #sink: NoteSink | undefined;
  /** Warnings already given this run. */
  readonly #warned = new Set<string>();
  #drawing = false;
  #warnings: string[] = [];
  #hints: string[] = [];
  readonly #scales = new PlacementScales();
  /** This frame's identity. */
  frame: object = {};

  constructor(sink?: NoteSink) {
    this.#sink = sink;
  }

  /** A new frame: `draw` runs, with no warnings yet. */
  begin(): void {
    this.#drawing = true;
    this.#warnings = [];
    this.#hints = [];
    this.#scales.beginFrame();
    this.frame = {};
  }

  /** `draw` returned (or threw): the frame's warnings and performance hints. */
  end(): { warnings: string[]; hints: string[] } {
    this.#drawing = false;
    return { warnings: this.#warnings, hints: this.#hints };
  }

  /** Throw unless `draw` is running: a View kept past `draw` (in the model, a module variable or a timer) records nothing. */
  live(call: string): void {
    if (!this.#drawing) throw new SketchUsageError({ detail: `v.${call} called outside draw: the View records only while draw runs; keep what you need in the model and draw it from draw` });
  }

  /** A `v.log` line, given to the sink as it happens; returns it. */
  log(message: string): string {
    this.#sink?.({ kind: "log", message });
    return message;
  }

  /** A warning naming the sketch's line, given once per run for each `once` key and line. */
  warn(once: string, message: string): void {
    this.#note(this.#warnings, { once, message, kind: "warn" });
  }

  /** A performance hint (draft section 10): nothing is wrong, but something costs every frame. Once per run, as `warn`. */
  hint(once: string, message: string): void {
    this.#note(this.#hints, { once: `hint ${once}`, message, kind: "hint" });
  }

  /** A top-level placement of a picture (testing mode): hints when its scale or rotation is new every frame. */
  placed(version: PictureVersion, matrix: Mat): void {
    const hint = this.#scales.placed(version, matrix);
    if (hint !== undefined) this.hint(`scale ${version.key}`, hint);
  }

  #note(into: string[], a: { once: string; message: string; kind: "warn" | "hint" }): void {
    const at = atSketchLine();
    if (this.#warned.has(a.once + at)) return;
    this.#warned.add(a.once + at);
    into.push(a.message + at);
    this.#sink?.({ kind: a.kind, message: a.message + at });
  }
}
