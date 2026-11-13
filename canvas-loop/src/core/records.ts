// Typed records from a key list, for TEA models keyed by id.

/** One entry per key, valued by `value(key)`. */
export function recordOf<K extends string, V>(keys: readonly K[], value: (key: K) => V): Record<K, V> {
  // eslint-disable-next-line no-restricted-syntax -- fromEntries widens keys to string; every key in K is present by construction
  return Object.fromEntries(keys.map((k) => [k, value(k)])) as Record<K, V>;
}
