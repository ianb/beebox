/**
 * Bounded-concurrency FIFO with a priority lane, for upload work.
 *
 * Why uploads need this at all: a browser will happily run six large uploads at
 * once (the per-host connection limit), and they then share one uplink. On a
 * weak link no single transfer can finish inside any per-request deadline, so
 * they all time out together, all retry from byte zero, and the link is spent
 * re-sending bytes it already sent. Serializing turns that collapse into steady
 * progress: each transfer gets the whole pipe, finishes, and stays finished.
 *
 * The priority lane exists because audio chunks are small and near-live — they
 * must not queue behind a 10 MB photo. Priority jumps ahead of waiting
 * non-priority work but never preempts something already running (there is no
 * way to pause an in-flight XHR without discarding its bytes, which is the very
 * waste this class exists to prevent).
 */

interface Waiter {
  priority: boolean;
  /** Claims a slot and releases the waiter's `acquire` promise. */
  start: () => void;
}

export class UploadQueue {
  private readonly concurrency: number;
  private running = 0;
  private readonly waiting: Waiter[] = [];

  constructor(opts: { concurrency: number }) {
    this.concurrency = opts.concurrency;
  }

  /** Tasks started but not yet settled. */
  get inFlight(): number {
    return this.running;
  }

  /** Tasks accepted but not yet started. */
  get queued(): number {
    return this.waiting.length;
  }

  /** Everything accepted and not yet settled — what a drain must wait for. */
  get outstanding(): number {
    return this.running + this.waiting.length;
  }

  /**
   * Accept a task, running it once a slot frees. Settles with the task's own
   * outcome, so a caller awaits `run(...)` exactly as it would the bare task.
   * A rejecting task still releases its slot.
   */
  async run<T>(task: () => Promise<T>, opts: { priority: boolean }): Promise<T> {
    await this.acquire(opts.priority);
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(priority: boolean): Promise<void> {
    if (this.running < this.concurrency) {
      this.running += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const waiter: Waiter = {
        priority,
        start: () => {
          this.running += 1;
          resolve();
        },
      };
      this.enqueue(waiter);
    });
  }

  /** Priority waiters land after any earlier priority waiters, before the rest. */
  private enqueue(waiter: Waiter): void {
    if (!waiter.priority) {
      this.waiting.push(waiter);
      return;
    }
    const firstOrdinary = this.waiting.findIndex((w) => !w.priority);
    if (firstOrdinary === -1) this.waiting.push(waiter);
    else this.waiting.splice(firstOrdinary, 0, waiter);
  }

  private release(): void {
    this.running -= 1;
    const next = this.waiting.shift();
    if (next) next.start();
  }
}
