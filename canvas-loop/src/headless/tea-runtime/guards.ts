// Testing-mode guards for a headless run: the model is frozen, so a `draw` or
// `update` that changes it in place fails at the line; sketch functions must
// be synchronous; the ambient nondeterministic globals throw for sketch code
// for the whole run, including callbacks the sketch scheduled; reading a param the sketch does not declare is an error
// naming the declared ones (it would be `undefined`, then NaN in arithmetic);
// and starting params are checked against the declaration.
import { AsyncLocalStorage } from "node:async_hooks";
import { checkParam } from "../../browser/param-validate.js";
import { SketchUsageError } from "../../core/errors.js";
import type { ParamsDecl, ParamValues } from "../../core/tea.js";
import { DeterminismError } from "../errors.js";

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

/** Throw when a sketch function returned a Promise. */
export function assertSync(result: unknown, step: string): void {
  if (result === null || typeof result !== "object") return;
  const then: unknown = Reflect.get(result, "then");
  if (typeof then !== "function") return;
  // The rest of an async body runs later and fails outside the frame; this error is the one to report.
  const ignore = (): void => {};
  Reflect.apply(then, result, [ignore, ignore]);
  throw new SketchUsageError({ detail: `${step}() returned a Promise: sketches must be synchronous (no async, no await)` });
}

// Sketch code, and everything it schedules (a microtask, a promise callback, a
// timer), runs in this context; the runtime's own work (the render) does not.
const sketchContext = new AsyncLocalStorage<true>();

/** Run `body` (a sketch call, with what checks its result) as sketch code: the guarded globals throw inside it and inside anything it schedules. */
export function asSketch<T>(body: () => T): T {
  return sketchContext.run(true, body);
}

/** `real` for the runtime; a DeterminismError for sketch code. */
function guarded<A extends unknown[], R>(real: (...args: A) => R, error: () => DeterminismError): (...args: A) => R {
  return (...args) => {
    if (sketchContext.getStore() === true) throw error();
    return real(...args);
  };
}

/**
 * Install the determinism guards for a whole run and return what restores the
 * originals: Math.random, Date.now, performance.now, and argless `new Date()`
 * / `Date()` throw a DeterminismError, pointing at the sketch's seeded
 * `random()` or the tick msg, when sketch code calls them (`asSketch`), also
 * from a callback the sketch scheduled that runs while the run awaits its
 * render. The runtime's own calls (the renderer reads the clock) get the real
 * functions. Decided by async context, not by file, so it holds when
 * canvas-loop is bundled.
 */
export function installGuards(): () => void {
  const realRandom = Math.random;
  const realDateNow = Date.now;
  const realPerfNow = performance.now;
  const realDate = globalThis.Date;
  const tick = (api: string) => () => new DeterminismError({ api, use: "a frame count from the tick msg" });

  const guardedNow = guarded(() => realDateNow(), tick("Date.now"));
  const guardedDate = new Proxy(realDate, {
    construct(target, args) {
      if (args.length === 0 && sketchContext.getStore() === true) throw tick("new Date")();
      return Reflect.construct(target, args);
    },
    apply(...call: [typeof realDate, unknown, unknown[]]) {
      if (sketchContext.getStore() === true) throw tick("Date")();
      return Reflect.apply(...call);
    },
    get(target, property) {
      if (property === "now") return guardedNow;
      return Reflect.get(target, property);
    },
  });

  Math.random = guarded(() => realRandom(), () => new DeterminismError({ api: "Math.random", use: "u.random() in init/update" }));
  Date.now = guardedNow;
  performance.now = guarded(() => realPerfNow.call(performance), tick("performance.now"));
  globalThis.Date = guardedDate;

  return () => {
    Math.random = realRandom;
    Date.now = realDateNow;
    performance.now = realPerfNow;
    globalThis.Date = realDate;
  };
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
