// Checks shared by the calls that take an options object or a style: an
// unknown key throws at the call, naming it and the keys there are, and a
// `name` must be a non-empty string. A key kept in a variable passes
// TypeScript's excess-property check, so without this it would be dropped
// silently.
import { SketchUsageError } from "../../core/errors.js";

/** Throw at `call` for the first key of `options` not in `keys`; `what` names the object in the message ("style key", "option"). */
export function checkKeys(call: string, a: { options: object; keys: readonly string[]; what: string }): void {
  for (const key of Object.keys(a.options)) {
    if (a.keys.includes(key)) continue;
    // The reporter's spelling for "this drawing takes clicks": there is no flag, a name is enough.
    const hint = key === "hit" ? "; there is no hit flag: every name is a target, so give the drawing a name" : "";
    throw new SketchUsageError({ detail: `${call}: unknown ${a.what} "${key}" (${a.keys.join(", ")})${hint}` });
  }
}

/** A drawing's `name`, checked at `call`: undefined, or a non-empty string. */
export function checkName(name: unknown, call: string): string | undefined {
  if (name === undefined) return undefined;
  if (typeof name !== "string" || name === "") throw new SketchUsageError({ detail: `${call}: name must be a non-empty string (got ${typeof name === "string" ? JSON.stringify(name) : typeof name})` });
  return name;
}
