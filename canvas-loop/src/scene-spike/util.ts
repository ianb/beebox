// The `Util` a spike run hands to `init` and `update`: seeded randomness,
// params, log, and text measured by the recorder's own measurer, as text with
// no transform inside the canvas (draft section 7).
import { formatArgs } from "../core/format.js";
import { SeededRandom } from "../core/prng.js";
import { recordOf } from "../core/records.js";
import { scaleNote } from "../core/sound/notes.js";
import type { ScaleName } from "../core/sound/notes.js";
import type { ParamsDecl, ParamValues, TextBounds, TextBox, TextOptions, Util } from "../core/tea.js";
import { SketchUsageError } from "../core/errors.js";
import type { TextMeasurer } from "../core/painter/text/measure.js";

export class SpikeUtil implements Util {
  readonly #random: SeededRandom;
  readonly #params: () => ParamValues<ParamsDecl>;
  readonly #text: TextMeasurer;
  readonly #canvas: { width: number; height: number };
  /** Lines logged since the runner last took them. */
  logs: string[] = [];

  constructor(options: { seed: number; params: () => ParamValues<ParamsDecl>; text: TextMeasurer; canvas: { width: number; height: number } }) {
    this.#random = new SeededRandom(options.seed);
    this.#params = options.params;
    this.#text = options.text;
    this.#canvas = options.canvas;
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
    const item = items[Math.floor(this.#random.next() * items.length)];
    if (item === undefined) throw new SketchUsageError({ detail: "randomChoice needs a non-empty array" });
    return item;
  }

  get params(): ParamValues<ParamsDecl> {
    return this.#params();
  }

  log(...args: readonly unknown[]): void {
    this.logs.push(formatArgs(args));
  }

  handled(_name: string): void {}

  record<K extends string, V>(keys: readonly K[], value: (key: K) => V): Record<K, V> {
    return recordOf(keys, value);
  }

  scaleNote(step: number, options?: { root?: string; scale?: ScaleName }): string {
    return scaleNote(step, options);
  }

  textWidth(content: string, options?: TextOptions): number {
    return this.#text.width(content, options);
  }

  textBounds(...[content, box, options]: [string, TextBox, TextOptions?]): TextBounds {
    const where = { transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, pixelRatio: 1, canvas: this.#canvas };
    return this.#text.place(content, { box, options: options ?? {}, where }).bounds;
  }
}
