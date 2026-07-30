/**
 * Bounded-concurrency FIFO for upload work, with an independent lane for small
 * latency-sensitive transfers.
 *
 * Why uploads need bounding at all: a browser will happily run six large
 * uploads at once (the per-host connection limit), and they then share one
 * uplink. On a weak link no single transfer can finish inside any per-request
 * deadline, so they all time out together, all retry from byte zero, and the
 * link is spent re-sending bytes it already sent. Bounding turns that collapse
 * into steady progress.
 *
 * Why two lanes rather than one queue with a priority flag: an in-flight XHR
 * cannot be paused without discarding the bytes it already sent, so "priority"
 * within a single lane can only jump the *waiting* line — a 40 KB audio chunk
 * behind a 10 MB photo still waits for the whole photo. Giving the small lane
 * its own slot makes audio genuinely near-live, and because each lane has its
 * own capacity, a steady stream of audio can never starve photos either (the
 * failure mode a single shared lane has).
 *
 * Two concurrent transfers do not recreate the six-way collapse: the lanes are
 * asymmetric by design — one bulk transfer plus one small one.
 */

interface Lane {
  readonly concurrency: number;
  running: number;
  readonly waiting: Array<() => void>;
}

function makeLane(concurrency: number): Lane {
  return { concurrency, running: 0, waiting: [] };
}

export class UploadQueue {
  private readonly bulk: Lane;
  private readonly priority: Lane;

  constructor(opts: { concurrency: number; priorityConcurrency: number }) {
    this.bulk = makeLane(opts.concurrency);
    this.priority = makeLane(opts.priorityConcurrency);
  }

  /** Tasks started but not yet settled, across both lanes. */
  get inFlight(): number {
    return this.bulk.running + this.priority.running;
  }

  /** Tasks accepted but not yet started, across both lanes. */
  get queued(): number {
    return this.bulk.waiting.length + this.priority.waiting.length;
  }

  /** Everything accepted and not yet settled — what a drain must wait for. */
  get outstanding(): number {
    return this.inFlight + this.queued;
  }

  /**
   * Accept a task, running it once its lane has a free slot. Settles with the
   * task's own outcome, so a caller awaits `run(...)` exactly as it would the
   * bare task. A rejecting task still releases its slot — one upload that gave
   * up must not wedge every upload behind it.
   */
  async run<T>(task: () => Promise<T>, opts: { priority: boolean }): Promise<T> {
    const lane = opts.priority ? this.priority : this.bulk;
    await UploadQueue.acquire(lane);
    try {
      return await task();
    } finally {
      UploadQueue.release(lane);
    }
  }

  private static acquire(lane: Lane): Promise<void> {
    if (lane.running < lane.concurrency) {
      lane.running += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      lane.waiting.push(() => {
        lane.running += 1;
        resolve();
      });
    });
  }

  private static release(lane: Lane): void {
    lane.running -= 1;
    const next = lane.waiting.shift();
    if (next) next();
  }
}
