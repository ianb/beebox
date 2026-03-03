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
  const proxy = Object.create(null) as Record<string, unknown>;
  proxy.callLog = callLog;
  for (const key of Object.keys(service)) {
    const orig = (service as Record<string, unknown>)[key];
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
