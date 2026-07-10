/**
 * Internal queue primitive shared by the real and fake chat backends.
 *
 * A queue-based async iterable: producers push items via `push()`, the
 * iterable yields them in order, and `end()` terminates iteration. Used to
 * adapt the SDK's pull-based query into a stream the chat session iterates,
 * and to feed user messages into the query.
 */

/**
 * A queue-based async iterable: producers push items via `push()`, the
 * iterable yields them in order, and `end()` terminates iteration.
 */
export function createAsyncIterableQueue<T>(): {
  push(item: T): void;
  end(): void;
  iterable: AsyncIterable<T>;
} {
  const queue: T[] = [];
  const waiters: Array<(v: IteratorResult<T>) => void> = [];
  let ended = false;

  function push(item: T): void {
    if (ended) return;
    const w = waiters.shift();
    if (w !== undefined) {
      w({ value: item, done: false });
    } else {
      queue.push(item);
    }
  }

  function end(): void {
    if (ended) return;
    ended = true;
    while (waiters.length > 0) {
      const w = waiters.shift();
      if (w !== undefined) w({ value: undefined, done: true });
    }
  }

  const iterable: AsyncIterable<T> = {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next(): Promise<IteratorResult<T>> {
          if (queue.length > 0) {
            // eslint-disable-next-line no-restricted-syntax -- length>0 guarantees shift() returns an element, not undefined
            const value = queue.shift() as T;
            return Promise.resolve({ value, done: false });
          }
          if (ended) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise((resolve) => {
            waiters.push(resolve);
          });
        },
      };
    },
  };

  return { push, end, iterable };
}
