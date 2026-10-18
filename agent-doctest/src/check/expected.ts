/**
 * `Expected<T>`: the type that makes an expected value a checked mirror of
 * the actual value. It is a plain (non-generic) parameter type, so the type
 * checker's own excess-property check rejects a key the actual value's type
 * does not have, at any depth.
 */

import type { Optional, Pattern, others } from "./patterns.js";

/**
 * An unordered collection: every expected item matches exactly one actual
 * item. Built by `unordered([...])`, where no actual item may be left over,
 * or `containing([...])`, where leftover actual items are allowed.
 */
export class Unordered<out I> {
  constructor(
    readonly items: readonly I[],
    readonly allowsOthers: boolean,
  ) {}
}

/**
 * Match an array regardless of order, keeping multiplicity. `I` comes only
 * from where the call stands (`NoInfer`), so an item is checked against the
 * actual element type, extra keys included.
 */
export function unordered<I>(items: readonly NoInfer<I>[]): Unordered<I> {
  return new Unordered(items, false);
}

/**
 * Match an array that holds these items, in any order, among others: the
 * array counterpart of `[others]`. Prefer the whole array when it is known.
 */
export function containing<I>(items: readonly NoInfer<I>[]): Unordered<I> {
  return new Unordered(items, true);
}

type Primitive = string | number | bigint | boolean | symbol | null | undefined;

/**
 * What may stand where the actual value has type `T`: the same shape, where
 * any position may be a pattern of its type.
 *
 * - A string position takes the literal (checked against literal unions) or
 *   any `Pattern<string>`; numbers and booleans likewise.
 * - A `Date` is written as its ISO string, a `Date`, or `isoDate()`.
 * - An optional key may be omitted, or written as `optional(...)`.
 * - An object may carry `[others]: pattern` for keys it does not list.
 */
export type Expected<T> =
  T extends string ? T | Pattern<string>
  : T extends number ? T | Pattern<number>
  : T extends boolean ? T | Pattern<boolean>
  : T extends Primitive ? T | Pattern<T>
  : T extends Date ? Date | string | Pattern<string>
  : T extends Map<infer K, infer V> ? Map<K, Expected<V>> | Pattern<T>
  : T extends Set<infer V> ? Set<Expected<V>> | Pattern<T>
  : T extends readonly unknown[] ? ExpectedArray<T> | Pattern<T>
  : T extends object ? ExpectedObject<T> | Pattern<T>
  : T | Pattern<T>;

/** A tuple keeps its length and per-position types; an array takes any length. */
type ExpectedArray<T extends readonly unknown[]> = number extends T["length"]
  ? readonly Expected<T[number]>[] | Unordered<Expected<T[number]>>
  : { readonly [I in keyof T]: Expected<T[I]> };

/** The values an object's unlisted keys can hold: what `[others]` must match. */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- a method-valued property is skipped whatever its signature
type DataValues<T> = { [K in keyof T]-?: T[K] extends Function ? never : T[K] }[keyof T];

type ExpectedObject<T> = {
  // Function-valued keys (methods) are not compared, so they are not listed.
  // The `as` clause keeps each key's optional modifier.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- a method-valued property is skipped whatever its signature
  readonly [K in keyof T as T[K] extends Function ? never : K]: Partial<Pick<T, K>> extends Pick<T, K>
    ? Expected<Exclude<T[K], undefined>> | Optional<Exclude<T[K], undefined>>
    : Expected<T[K]>;
} & { readonly [others]?: Pattern<DataValues<T>> };
