/**
 * The page's activity queue (plan `docs/implemented-plans/activity-log.md`, Track D):
 * ordered, bounded, best-effort. Reporters `push` entries; one request is in
 * flight at a time, batches go out in the order they were pushed. A request
 * is never abandoned while in flight. A failed batch retries with backoff
 * until its failures span a minute, then is dropped with one console warning. It never throws to a caller and never blocks the UI.
 */

import type { ActivityEntryInput } from "@core/activity/entry.js";

/** Most entries in one request (the route accepts 1..200). */
export const MAX_BATCH = 200;
/** Above this many waiting entries the oldest are dropped. */
export const MAX_QUEUED = 500;
/** A batch is dropped once its failures have spanned this long. */
export const RETRY_WINDOW_MS = 60_000;
/** Wait before the first send, so a burst of pushes travels as one batch. */
const BATCH_DELAY_MS = 250;
const FIRST_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 8_000;

/** Sends one batch; rejects when the server could not take it. */
export type ActivityTransport = (entries: ActivityEntryInput[]) => Promise<unknown>;

/** Time source; tests inject a manual one. `after` returns its cancel function. */
export interface ActivityTimers {
  now: () => number;
  after: (ms: number, run: () => void) => () => void;
}

export const realTimers: ActivityTimers = {
  now: () => Date.now(),
  after: (ms, run) => { const id = setTimeout(run, ms); return () => { clearTimeout(id); }; },
};

export class ActivityQueue {
  private waiting: ActivityEntryInput[] = [];
  private running = false;
  private cancelDelay: (() => void) | null = null;
  private readonly idleWaiters = new Set<() => void>();

  constructor(private readonly options: { transport: ActivityTransport; timers: ActivityTimers }) {}

  /** Queue an entry. Never throws. */
  push(entry: ActivityEntryInput): void {
    this.waiting.push(entry);
    if (this.waiting.length > MAX_QUEUED) {
      const dropped = this.waiting.length - MAX_QUEUED;
      this.waiting.splice(0, dropped);
      console.warn(`activity: queue full, dropped the ${String(dropped)} oldest ${dropped === 1 ? "entry" : "entries"}`);
    }
    if (!this.running && this.cancelDelay === null) {
      this.cancelDelay = this.options.timers.after(BATCH_DELAY_MS, () => { this.cancelDelay = null; this.start(); });
    }
  }

  /**
   * Send what is queued now and resolve when the queue is empty, or after
   * `timeoutMs`, whichever comes first. Never rejects.
   */
  flush(timeoutMs: number): Promise<void> {
    if (this.waiting.length === 0 && !this.running) return Promise.resolve();
    this.cancelDelay?.();
    this.cancelDelay = null;
    this.start();
    return new Promise<void>((resolve) => {
      const done = (): void => { cancel(); this.idleWaiters.delete(done); resolve(); };
      const cancel = this.options.timers.after(timeoutMs, done);
      this.idleWaiters.add(done);
    });
  }

  private start(): void {
    if (this.running) return;
    this.running = true;
    void this.drain();
  }

  private async drain(): Promise<void> {
    try {
      while (this.waiting.length > 0) {
        const batch = this.waiting.splice(0, MAX_BATCH);
        await this.sendWithRetry(batch);
      }
    } finally {
      this.running = false;
      for (const wake of [...this.idleWaiters]) wake();
    }
  }

  /**
   * Resolves once the batch is sent or given up on; never rejects. A request
   * that is still in flight is never abandoned, however slow: the next batch
   * waits behind it, so the log keeps the order entries were pushed in. Only
   * failed responses count toward the one-minute window, measured from the
   * first failure. A batch the server accepted whose response was lost is
   * retried and can be logged twice; that is accepted, there is no dedup.
   */
  private async sendWithRetry(batch: ActivityEntryInput[]): Promise<void> {
    const { timers } = this.options;
    let firstFailureAt: number | null = null;
    let backoff = FIRST_BACKOFF_MS;
    for (;;) {
      if (await this.attempt(batch)) return;
      firstFailureAt ??= timers.now();
      if (timers.now() + backoff - firstFailureAt >= RETRY_WINDOW_MS) {
        console.warn(`activity: gave up on ${String(batch.length)} ${batch.length === 1 ? "entry" : "entries"} after ${String(RETRY_WINDOW_MS / 1000)}s of failures`);
        return;
      }
      await new Promise<void>((resolve) => { timers.after(backoff, resolve); });
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  }

  /** One send; true when the server took it. Waits as long as the request takes. */
  private async attempt(batch: ActivityEntryInput[]): Promise<boolean> {
    try {
      await this.options.transport(batch);
      return true;
    } catch (_error) {
      return false; // retried, and reported by the one drop warning when the window closes
    }
  }
}
