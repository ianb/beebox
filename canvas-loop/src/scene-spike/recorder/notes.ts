// The recorder's bookkeeping for messages: whether `draw` is running (a View
// kept past `draw` must refuse to record), the frame's identity (a Picture
// handle from another frame is refused by `place`), and testing-mode warnings,
// each naming the sketch's line and given once per run.
import { SketchUsageError } from "../../core/errors.js";
import { atSketchLine } from "../call-site.js";

export class RecorderNotes {
  /** Warnings already given this run. */
  readonly #warned = new Set<string>();
  #drawing = false;
  #warnings: string[] = [];
  /** This frame's identity. */
  frame: object = {};

  /** A new frame: `draw` runs, with no warnings yet. */
  begin(): void {
    this.#drawing = true;
    this.#warnings = [];
    this.frame = {};
  }

  /** `draw` returned (or threw): the frame's warnings. */
  end(): string[] {
    this.#drawing = false;
    return this.#warnings;
  }

  /** Throw unless `draw` is running: a View kept past `draw` (in the model, a module variable or a timer) records nothing. */
  live(call: string): void {
    if (!this.#drawing) throw new SketchUsageError({ detail: `v.${call} called outside draw: the View records only while draw runs; keep what you need in the model and draw it from draw` });
  }

  /** A warning naming the sketch's line, given once per run for each `once` key and line. */
  warn(once: string, message: string): void {
    const at = atSketchLine();
    if (this.#warned.has(once + at)) return;
    this.#warned.add(once + at);
    this.#warnings.push(message + at);
  }
}
