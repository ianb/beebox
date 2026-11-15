// Testing-mode guards for a headless run: the model is frozen, so a `draw` or
// `update` that changes it in place fails at the line; sketch functions must
// be synchronous; the ambient nondeterministic globals throw while a sketch
// function runs; reading a param the sketch does not declare is an error
// naming the declared ones (it would be `undefined`, then NaN in arithmetic);
// and starting params are checked against the declaration.
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

/**
 * Run `body` (one sketch call) with the ambient nondeterministic globals
 * virtualized: Math.random, Date.now, performance.now, and argless `new Date()`
 * / `Date()` throw a DeterminismError pointing at the sketch's seeded
 * `random()` or the tick msg. Originals are restored even if `body` throws.
 *
 * `body` must be synchronous: the guards are process-wide while it runs, so the
 * runner wraps each sketch call and never awaits under them (the GPU render
 * reads the clock).
 */
export function withGuards<T>(body: () => T): T {
  const realRandom = Math.random;
  const realDateNow = Date.now;
  const realPerfNow = performance.now;
  const realDate = globalThis.Date;

  const guardedDate = new Proxy(realDate, {
    construct(target, args) {
      if (args.length === 0) {
        throw new DeterminismError({ api: "new Date", use: "a frame count from the tick msg" });
      }
      return Reflect.construct(target, args);
    },
    apply() {
      throw new DeterminismError({ api: "Date", use: "a frame count from the tick msg" });
    },
    get(target, property) {
      if (property === "now") {
        return () => {
          throw new DeterminismError({ api: "Date.now", use: "a frame count from the tick msg" });
        };
      }
      return Reflect.get(target, property);
    },
  });

  Math.random = () => {
    throw new DeterminismError({ api: "Math.random", use: "u.random() in init/update" });
  };
  Date.now = () => {
    throw new DeterminismError({ api: "Date.now", use: "a frame count from the tick msg" });
  };
  performance.now = () => {
    throw new DeterminismError({ api: "performance.now", use: "a frame count from the tick msg" });
  };
  globalThis.Date = guardedDate;

  try {
    return body();
  } finally {
    Math.random = realRandom;
    Date.now = realDateNow;
    performance.now = realPerfNow;
    globalThis.Date = realDate;
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
