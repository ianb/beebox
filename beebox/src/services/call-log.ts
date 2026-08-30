/**
 * Call logging for service fakes — wraps any service object to record method calls.
 *
 * Usage (tests only):
 *   const telegram = withCallLog(createFakeTelegram({ username: "bot" }));
 *   // ... exercise code that uses telegram ...
 *   printCalls(telegram.callLog, "sendMessage")
 */

export interface CallEntry {
  method: string;
  args: unknown[];
  result: unknown;
}

export type WithCallLog<T> = T & { callLog: CallEntry[] };

/**
 * Wrap a service object so every method call is recorded in `.callLog`.
 * Non-function properties are passed through unchanged.
 */
export function withCallLog<T extends object>(service: T): WithCallLog<T> {
  const callLog: CallEntry[] = [];
  const proxy: Record<string, unknown> = Object.create(null);
  proxy.callLog = callLog;
  for (const key of Object.keys(service)) {
    const orig: unknown = Reflect.get(service, key);
    if (typeof orig === "function") {
      proxy[key] = async (...args: unknown[]) => {
        const result = await orig.apply(service, args);
        callLog.push({ method: key, args, result });
        return result;
      };
    } else {
      proxy[key] = orig;
    }
  }
  // eslint-disable-next-line no-restricted-syntax -- reflection proxy: every own key of `service` was copied above, so the dynamic object structurally satisfies WithCallLog<T> (unprovable to TS)
  return proxy as WithCallLog<T>;
}

/**
 * Format call log entries as readable strings for doctest assertions.
 * Optional `method` filter shows only calls to that method.
 */
export function printCalls(log: CallEntry[], method?: string): string {
  const entries = method ? log.filter((c) => c.method === method) : log;
  return entries
    .map(
      (e) =>
        `${e.method}(${e.args.map((a) => JSON.stringify(a)).join(", ")})`,
    )
    .join("\n");
}
