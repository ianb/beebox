// The `Util` a spike run hands to `init` and `update`: seeded randomness,
// params and log. Text measurement waits for text (chunk 3).
import { formatArgs } from "../../core/format.js";
import { SeededRandom } from "../../core/prng.js";
import { recordOf } from "../../core/records.js";
import { scaleNote } from "../../core/sound/notes.js";
import type { ScaleName } from "../../core/sound/notes.js";
import type { ParamsDecl, ParamValues, TextBounds, TextBox, TextOptions, Util } from "../../core/tea.js";
import { SketchUsageError } from "../../core/errors.js";
import { UnsupportedCallError } from "../errors.js";

export class SpikeUtil implements Util {
  readonly #random: SeededRandom;
  readonly #params: () => ParamValues<ParamsDecl>;
  /** Lines logged since the runner last took them. */
  logs: string[] = [];

  constructor(options: { seed: number; params: () => ParamValues<ParamsDecl> }) {
    this.#random = new SeededRandom(options.seed);
    this.#params = options.params;
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

  textWidth(_content: string, _options?: TextOptions): number {
    throw new UnsupportedCallError({ call: "u.textWidth" });
  }

  textBounds(..._args: [string, TextBox, TextOptions?]): TextBounds {
    throw new UnsupportedCallError({ call: "u.textBounds" });
  }
}
