// Testing-mode guards for a headless run: the model is frozen, so a `draw` or
// `update` that changes it in place fails at the line; sketch functions must
// be synchronous, so while one runs it can neither read the ambient
// nondeterministic globals nor schedule work for later; reading a param the
// sketch does not declare is an error naming the declared ones (it would be
// `undefined`, then NaN in arithmetic); and starting params are checked
// against the declaration.
//
// Not covered: an `async` function the sketch starts and does not return.
// Native `await` does not go through `Promise.prototype.then`, so its
// continuation runs after the call, unguarded (tea-runtime.guards test).
import { checkParam } from "../../browser/param-validate.js";
import { SketchUsageError } from "../../core/errors.js";
import type { ParamsDecl, ParamValues } from "../../core/tea.js";
import { DeterminismError } from "../errors.js";

const REAL_THEN = Promise.prototype.then;

/** Freeze `value` and everything it holds; a later change throws at the sketch's line. */
export function deepFreeze(value: unknown): void {
  freezeInto(value, new WeakSet());
}

function freezeInto(value: unknown, seen: WeakSet<object>): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) freezeInto(Reflect.get(value, key), seen);
  Object.freeze(value);
}

/** Throw when a sketch function returned a Promise (or another thenable). */
export function assertSync(result: unknown, step: string): void {
  if (result === null || typeof result !== "object") return;
  // A native Promise is read with the real `then`: under the guards, `Promise.prototype.then` is the stub.
  const then: unknown = result instanceof Promise ? REAL_THEN : Reflect.get(result, "then");
  if (typeof then !== "function") return;
  // The rest of an async body runs later and fails outside the frame; this error is the one to report.
  const ignore = (): void => {};
  Reflect.apply(then, result, [ignore, ignore]);
  throw new SketchUsageError({ detail: `${step}() returned a Promise: sketches must be synchronous (no async, no await)` });
}

/** A global the guards replace while a sketch call runs: where it lives and its name. */
interface Slot {
  readonly owner: object;
  readonly key: string;
}

/** A stub that throws the DeterminismError for `api`. */
function refuse(api: string, use?: string): () => never {
  return () => {
    throw new DeterminismError({ api, ...(use === undefined ? {} : { use }) });
  };
}

/** What a sketch call may not reach, and what replaces it while the call runs. */
function stubs(): [Slot, unknown][] {
  const tick = "a frame count from the tick msg";
  const realDate = globalThis.Date;
  const guardedDate = new Proxy(realDate, {
    construct(target, args) {
      if (args.length === 0) throw new DeterminismError({ api: "new Date", use: tick });
      return Reflect.construct(target, args);
    },
    apply: refuse("Date", tick),
    get(target, property) {
      return property === "now" ? refuse("Date.now", tick) : Reflect.get(target, property);
    },
  });
  const out: [Slot, unknown][] = [
    [{ owner: Math, key: "random" }, refuse("Math.random", "u.random() in init/update")],
    [{ owner: Date, key: "now" }, refuse("Date.now", tick)],
    [{ owner: performance, key: "now" }, refuse("performance.now", tick)],
    [{ owner: globalThis, key: "Date" }, guardedDate],
    // Sketch code runs synchronously: nothing it schedules could run at a frame it controls.
    [{ owner: Promise.prototype, key: "then" }, refuse("Promise.then")],
    [{ owner: process, key: "nextTick" }, refuse("process.nextTick")],
  ];
  for (const key of ["setTimeout", "setInterval", "setImmediate", "queueMicrotask", "requestAnimationFrame"]) {
    if (typeof Reflect.get(globalThis, key) === "function") out.push([{ owner: globalThis, key }, refuse(key)]);
  }
  return out;
}

/**
 * Run `body` (one sketch call, and the check or freeze of its result) with the
 * guards in place: Math.random, Date.now, performance.now and argless
 * `new Date()` / `Date()` throw a DeterminismError pointing at the seeded
 * `random()` or the tick msg; timers, `queueMicrotask`, `process.nextTick`
 * and `Promise.prototype.then` (so `catch` and `finally` too) throw one saying
 * sketch code cannot schedule work. Everything is restored, synchronously,
 * before this returns or throws. `body` must be synchronous: the runner never
 * awaits under the guards (the GPU render reads the clock).
 */
export function withGuards<T>(body: () => T): T {
  const replaced = stubs().map(([slot, stub]) => {
    const real: unknown = Reflect.get(slot.owner, slot.key);
    Reflect.set(slot.owner, slot.key, stub);
    return { slot, real };
  });
  try {
    return body();
  } finally {
    for (const { slot, real } of replaced.toReversed()) Reflect.set(slot.owner, slot.key, real);
  }
}

// Names `await` and `JSON.stringify` probe on any object; a sketch does not read them as params.
const PROBES = new Set(["toJSON", "then"]);

/** `values` frozen, behind a guard that throws on reading a param `decl` does not declare. */
export function guardParams(decl: ParamsDecl, values: ParamValues<ParamsDecl>): ParamValues<ParamsDecl> {
  const frozen = Object.freeze({ ...values });
  const declared = Object.keys(decl);
  return new Proxy(frozen, {
    get(target, key): unknown {
      if (typeof key === "string" && !Object.hasOwn(decl, key) && !PROBES.has(key)) {
        throw new SketchUsageError({ detail: `params.${key}: the sketch declares no param "${key}" (declared: ${declared.length === 0 ? "none" : declared.join(", ")}); add it to the params export` });
      }
      return Reflect.get(target, key);
    },
  });
}

/**
 * The params the first frame sees: each declared default, or its starting
 * value. A name the sketch does not declare is an error; so is a value
 * `checkParam` would refuse or adjust (a clamped number, a trigger), so a run
 * never reports success on a value the figure would not show.
 */
export function startParams(decl: ParamsDecl, initial: Readonly<Record<string, number | boolean | string>>): ParamValues<ParamsDecl> {
  for (const [name, value] of Object.entries(initial)) {
    const param = decl[name];
    if (param === undefined) throw new SketchUsageError({ detail: `initial param "${name}": the sketch declares no such param` });
    const check = checkParam(param, value);
    if (!check.ok) throw new SketchUsageError({ detail: `initial param "${name}": ${check.reason}` });
    if (check.note !== undefined) throw new SketchUsageError({ detail: `initial param "${name}": refused, since it would be ${check.note}` });
  }
  const values: Record<string, number | boolean | string> = {};
  for (const [name, p] of Object.entries(decl)) if (p.type !== "trigger") values[name] = initial[name] ?? p.default;
  return values;
}
