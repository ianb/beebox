// The `Util` a headless run hands to `init` and `update`: the run's seeded
// random stream, a live view of the params, `log`, engagement names
// (`u.handled`), and text measured as the run's `draw` lays it out. No drawing
// surface and no GPU object: `update` cannot paint.
import type { TextBounds, TextBox, TextOptions, TextRun } from "../core/paint.js";
import { checkContent } from "../core/text/measure.js";
import type { SeededRandom } from "../core/prng.js";
import { recordOf } from "../core/records.js";
import { scaleNote } from "../core/sound/notes.js";
import type { ScaleName } from "../core/sound/notes.js";
import type { ParamsDecl, ParamValues, Util } from "../core/tea.js";
import { SketchUsageError } from "./errors.js";

/** Text measured as the run's `draw` measures it, for `u.textWidth` and `u.textBounds`. */
export interface UtilText {
  width(content: string | readonly TextRun[], options?: TextOptions): number;
  bounds(...args: [string | readonly TextRun[], TextBox, TextOptions?]): TextBounds;
}

export class TeaUtil<D extends ParamsDecl> implements Util<D> {
  readonly #random: SeededRandom;
  readonly #getParams: () => ParamValues<D>;
  readonly #onHandled: (name: string) => void;
  readonly #log: (message: readonly unknown[]) => void;
  readonly #text: UtilText;

  constructor(deps: { random: SeededRandom; getParams: () => ParamValues<D>; onHandled: (name: string) => void; log: (args: readonly unknown[]) => void; text: UtilText }) {
    this.#random = deps.random;
    this.#getParams = deps.getParams;
    this.#onHandled = deps.onHandled;
    this.#log = deps.log;
    this.#text = deps.text;
  }

  random(): number;
  random(max: number): number;
  random(min: number, max: number): number;
  random(a?: number, b?: number): number {
    const r = this.#random.next();
    if (a === undefined) return r;
    if (b === undefined) return r * a;
    return a + r * (b - a);
  }

  randomChoice<T>(items: readonly T[]): T {
    const picked = items[Math.floor(this.#random.next() * items.length)];
    if (picked === undefined) throw new SketchUsageError({ detail: "randomChoice() requires a non-empty array" });
    return picked;
  }

  get params(): ParamValues<D> {
    return this.#getParams();
  }

  log(...args: readonly unknown[]): void {
    this.#log(args);
  }

  record<K extends string, V>(keys: readonly K[], value: (key: K) => V): Record<K, V> {
    return recordOf(keys, value);
  }

  handled(name: string): void {
    this.#onHandled(name);
  }

  scaleNote(step: number, options?: { root?: string; scale?: ScaleName }): string {
    return scaleNote(step, options);
  }

  textWidth(content: string | readonly TextRun[], options?: TextOptions): number {
    checkContent(content, { call: "u.textWidth", options });
    return this.#text.width(content, options);
  }

  textBounds(...[content, box, options]: [string | readonly TextRun[], TextBox, TextOptions?]): TextBounds {
    checkContent(content, { call: "u.textBounds", options });
    return this.#text.bounds(content, box, options);
  }
}
