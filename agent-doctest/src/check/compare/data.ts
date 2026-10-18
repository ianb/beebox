/**
 * How values look to the matcher: which entries of an object are compared,
 * and the display data each side of a diff is rendered from.
 */

import { Unordered } from "../expected.js";
import { Optional, Pattern, others } from "../patterns.js";
import { Call, OTHERS_KEY, Source } from "./render.js";

/** Values whose meaning is not in their data: they cannot be compared. */
export function isUncomparable(value: unknown): boolean {
  if (typeof value === "function") return true;
  if (value === null || typeof value !== "object") return false;
  if (value instanceof Promise || value instanceof WeakMap || value instanceof WeakSet || value instanceof WeakRef) return true;
  // A thenable: its value arrives later.
  if (typeof (value as { then?: unknown }).then === "function") return true;
  // Boxed primitives and binary buffers hold their state in internal slots.
  const tag = Object.prototype.toString.call(value);
  return tag === "[object Number]" || tag === "[object String]" || tag === "[object Boolean]" || tag === "[object ArrayBuffer]";
}

export function isPlainData(value: object): boolean {
  return !Array.isArray(value) && !(value instanceof Map) && !(value instanceof Set) && !(value instanceof Date)
    && !(value instanceof RegExp) && !ArrayBuffer.isView(value);
}

/** Why an object's data cannot be compared, or null when it can. */
export function hiddenStateProblem(value: object): string | null {
  if (Object.getOwnPropertySymbols(value).some((s) => Object.prototype.propertyIsEnumerable.call(value, s))) {
    return "has symbol keys, which cannot be compared; check a projection of it";
  }
  const proto: unknown = Object.getPrototypeOf(value);
  const plain = proto === Object.prototype || proto === null;
  if (!plain && !(value instanceof Error) && Object.keys(value).length === 0) {
    return "is a class instance with no own data to compare (its state is private); check a projection of it";
  }
  return null;
}

/**
 * The compared entries of an object: its own enumerable string keys, in a
 * prototype-less container so no key is lost or inherited. An `Error` also
 * contributes its `name` and `message`, but not its `stack`. Function-valued
 * keys (methods, callbacks) are not data and are left out.
 */
export function dataOf(value: object): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  if (value instanceof Error) {
    out.name = value.name;
    out.message = value.message;
  }
  for (const k of Object.keys(value)) {
    if (value instanceof Error && k === "stack") continue;
    const v: unknown = (value as Record<string, unknown>)[k];
    if (typeof v === "function") continue;
    out[k] = v;
  }
  return out;
}

export function hasKey(data: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(data, key);
}

/** The actual value as display data: objects become their compared entries. */
export function view(value: unknown, seen = new Set<object>()): unknown {
  if (value instanceof Source || value instanceof Call) return value;
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date || value instanceof RegExp || ArrayBuffer.isView(value) || isUncomparable(value)) return value;
  if (seen.has(value)) return new Source("[Circular]");
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((v) => view(v, seen));
    if (value instanceof Map) return new Map([...value].map(([k, v]) => [k, view(v, seen)]));
    if (value instanceof Set) return new Set([...value].map((v) => view(v, seen)));
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [k, v] of Object.entries(dataOf(value))) out[k] = view(v, seen);
    return out;
  } finally {
    seen.delete(value);
  }
}

/** The expected value as display data: patterns print as their source. */
export function expectedView(expected: unknown): unknown {
  if (expected instanceof Pattern || expected instanceof Optional) return new Source(expected.source);
  if (expected instanceof Unordered) return new Call("unordered", expected.items.map(expectedView));
  if (expected === null || typeof expected !== "object") return expected;
  if (Array.isArray(expected)) return expected.map(expectedView);
  if (expected instanceof Map) return new Map([...expected].map(([k, v]) => [k, expectedView(v)]));
  if (expected instanceof Set) return new Set([...expected].map(expectedView));
  if (!isPlainData(expected)) return expected;
  const out: Record<PropertyKey, unknown> = Object.create(null) as Record<PropertyKey, unknown>;
  for (const [k, v] of Object.entries(dataOf(expected))) out[k] = expectedView(v);
  const rest = (expected as { [others]?: unknown })[others];
  if (rest instanceof Pattern) out[OTHERS_KEY] = new Source(rest.source);
  return out;
}
