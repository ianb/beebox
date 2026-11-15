// Testing-mode guards for a headless scene run, as today's runtime has them
// (headless/tea-runtime.ts): the model is frozen, so a `draw` or `update` that
// changes it in place fails at the line; `init`, `update` and `draw` must be
// synchronous; and reading a param the sketch does not declare is an error
// naming the declared ones (it would be `undefined`, then NaN in arithmetic).
import { SketchUsageError } from "../../core/errors.js";
import type { ParamsDecl, ParamValues } from "../../core/tea.js";

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

/** Throw when `init`, `update` or `draw` returned a Promise. */
export function assertSync(result: unknown, step: string): void {
  if (result === null || typeof result !== "object") return;
  const then: unknown = Reflect.get(result, "then");
  if (typeof then !== "function") return;
  // The rest of an async body runs later and fails outside the frame; this error is the one to report.
  const ignore = (): void => {};
  Reflect.apply(then, result, [ignore, ignore]);
  throw new SketchUsageError({ detail: `${step}() returned a Promise: sketches must be synchronous (no async, no await)` });
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
