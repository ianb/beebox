// The capability handed to `init`/`update` in the browser: seeded randomness
// (the same mulberry32 stream the CLI uses, so a recorded session replays
// byte-for-byte headless), a live view of the resolved param values, and `log`.
// No drawing surface — `update` cannot paint, exactly as in the headless runtime.
import { SketchUsageError } from "../src/headless/errors.js";
import type { SeededRandom } from "../src/core/prng.js";
import type { ParamsDecl, ParamValues, Util } from "../src/core/tea.js";

export class BrowserUtil<D extends ParamsDecl> implements Util<D> {
  #random: SeededRandom;
  #getParams: () => ParamValues<D>;
  #log: (args: readonly unknown[]) => void;
  #onHandled: (name: string) => void;

  constructor(deps: {
    random: SeededRandom;
    getParams: () => ParamValues<D>;
    log: (args: readonly unknown[]) => void;
    onHandled: (name: string) => void;
  }) {
    this.#random = deps.random;
    this.#getParams = deps.getParams;
    this.#log = deps.log;
    this.#onHandled = deps.onHandled;
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
    if (items.length === 0) throw new SketchUsageError({ detail: "randomChoice() requires a non-empty array" });
    const picked = items[Math.floor(this.#random.next() * items.length)];
    if (picked === undefined) throw new SketchUsageError({ detail: "randomChoice() drew an out-of-range index" });
    return picked;
  }

  get params(): ParamValues<D> {
    return this.#getParams();
  }

  log(...args: readonly unknown[]): void {
    this.#log(args);
  }

  handled(name: string): void {
    this.#onHandled(name);
  }
}
