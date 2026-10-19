/**
 * `eventually(fn)`: poll until `fn` returns a value that is not false, null,
 * or undefined, and return it. Errors thrown by `fn` count as "not yet".
 * After `timeoutMs` it throws an `EventuallyTimeout` error naming the last
 * value or error.
 *
 * The same helper doctests get as a built-in (doctest-runtime.ts EVENTUALLY).
 */

export interface EventuallyOptions {
  /** Names the condition in the timeout message. */
  label?: string;
  timeoutMs?: number;
  intervalMs?: number;
}

export async function eventually<T>(
  fn: () => T | Promise<T>,
  { label = "condition", timeoutMs = 5000, intervalMs = 25 }: EventuallyOptions = {},
): Promise<NonNullable<Exclude<T, false>>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let value: T | undefined;
    let error: unknown;
    try {
      value = await fn();
    } catch (e) {
      error = e;
    }
    // Truthiness of `error`, as the runtime's helper: a thrown 0 or "" counts as no error.
    if (!error && value !== false && value !== undefined && value !== null) {
      // The checks above exclude false, null, and undefined; TypeScript cannot narrow a generic by them.
      return value as NonNullable<Exclude<T, false>>;
    }
    if (Date.now() >= deadline) {
      const message: unknown = typeof error === "object" && error !== null && "message" in error ? error.message : undefined;
      const last = error ? `error: ${String(message ?? error)}` : `value: ${JSON.stringify(value)}`;
      const timeout = new Error(`${label} was not true after ${timeoutMs}ms; last ${last}`, error ? { cause: error } : {});
      timeout.name = "EventuallyTimeout";
      throw timeout;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
