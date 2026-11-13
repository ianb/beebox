import type { ActivityTimers } from "../../../src/lib/activity/queue.js";

/** A clock tests advance by hand; `advance` runs due timers in order and lets promises settle between them. */
export interface ManualClock extends ActivityTimers {
  advance: (ms: number) => Promise<void>;
}

const settle = (): Promise<void> => new Promise<void>((resolve) => { setImmediate(resolve); });

export function manualClock(): ManualClock {
  let time = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    now: () => time,
    after(ms, run) {
      const id = nextId++;
      timers.set(id, { at: time + ms, run });
      return () => { timers.delete(id); };
    },
    async advance(ms) {
      const target = time + ms;
      await settle();
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).toSorted((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        time = Math.max(time, due[1].at);
        due[1].run();
        await settle();
      }
      time = target;
    },
  };
}
