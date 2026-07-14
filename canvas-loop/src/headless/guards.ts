import { DeterminismError } from "./errors.js";

/**
 * Run `body` with the ambient nondeterministic globals virtualized: Math.random,
 * Date.now, performance.now, and argless `new Date()` / `Date()` all throw a
 * DeterminismError pointing at the sketch's seeded `random()` / `millis()`.
 * Originals are always restored, even if `body` throws.
 *
 * `body` must be fully synchronous — the guards are installed process-wide for
 * its duration, so nothing async should run underneath them.
 */
export function withGuards<T>(body: () => T): T {
  const realRandom = Math.random;
  const realDateNow = Date.now;
  const realPerfNow = performance.now;
  const realDate = globalThis.Date;

  const guardedDate = new Proxy(realDate, {
    construct(target, args) {
      if (args.length === 0) {
        throw new DeterminismError({ api: "new Date", use: "s.millis()" });
      }
      return Reflect.construct(target, args);
    },
    apply() {
      throw new DeterminismError({ api: "Date", use: "s.millis()" });
    },
    get(target, property) {
      if (property === "now") {
        return () => {
          throw new DeterminismError({ api: "Date.now", use: "s.millis()" });
        };
      }
      return Reflect.get(target, property);
    },
  });

  Math.random = () => {
    throw new DeterminismError({ api: "Math.random", use: "s.random()" });
  };
  Date.now = () => {
    throw new DeterminismError({ api: "Date.now", use: "s.millis()" });
  };
  performance.now = () => {
    throw new DeterminismError({ api: "performance.now", use: "s.millis()" });
  };
  globalThis.Date = guardedDate;

  try {
    return body();
  } finally {
    Math.random = realRandom;
    Date.now = realDateNow;
    performance.now = realPerfNow;
    globalThis.Date = realDate;
  }
}
