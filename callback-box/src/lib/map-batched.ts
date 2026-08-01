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
