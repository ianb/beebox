/**
 * Map over a list with bounded concurrency.
 *
 * `Promise.all(items.map(...))` on a box-sized card list opens one file handle
 * per card at once — fine for a dozen cards, an fd exhaustion / IO contention
 * risk for a few thousand on an endpoint every page load hits. Batches keep the
 * parallelism (which is the whole speedup) without the unbounded fan-out.
 *
 * Results come back in input order.
 */
export async function mapInBatches<T, R>(
  items: readonly T[],
  { size, map }: { size: number; map: (item: T) => Promise<R> },
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    results.push(...(await Promise.all(items.slice(i, i + size).map(map))));
  }
  return results;
}

/**
 * `mapInBatches`, but one item's failure doesn't abandon the rest — the
 * `allSettled` counterpart, which code-style makes the default for independent
 * tasks. Use it for the box-wide scans where a single unreadable file must cost
 * exactly one row, not the whole list.
 *
 * Results come back in input order, so a caller can pair an outcome with the
 * item that produced it (which is what makes a per-item failure reportable).
 */
export async function mapInBatchesSettled<T, R>(
  items: readonly T[],
  { size, map }: { size: number; map: (item: T) => Promise<R> },
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += size) {
    results.push(...(await Promise.allSettled(items.slice(i, i + size).map(map))));
  }
  return results;
}
