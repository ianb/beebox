/**
 * The page's activity queue (plan `docs/plans/activity-log.md`, Track D):
 * ordered, bounded, best-effort. Reporters `push` entries; one request is in
 * flight at a time, batches go out in the order they were pushed. A failed
 * batch retries with backoff for up to a minute, then is dropped with one
 * console warning. It never throws to a caller and never blocks the UI.
 */

import type { ActivityEntryInput } from "@core/activity/entry.js";

/** Most entries in one request (the route accepts 1..200). */
export const MAX_BATCH = 200;
/** Above this many waiting entries the oldest are dropped. */
export const MAX_QUEUED = 500;
/** A batch is dropped once it has failed for this long. */
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

  /** Resolves once the batch is sent or given up on; never rejects. */
  private async sendWithRetry(batch: ActivityEntryInput[]): Promise<void> {
    const { timers } = this.options;
    const deadline = timers.now() + RETRY_WINDOW_MS;
    let backoff = FIRST_BACKOFF_MS;
    for (;;) {
      const outcome = await this.attempt(batch, deadline - timers.now());
      if (outcome === "sent") return;
      if (timers.now() + backoff >= deadline) {
        console.warn(`activity: gave up on ${String(batch.length)} ${batch.length === 1 ? "entry" : "entries"} after ${String(RETRY_WINDOW_MS / 1000)}s of failures`);
        return;
      }
      await new Promise<void>((resolve) => { timers.after(backoff, resolve); });
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  }

  /** One send, bounded by the time left; a hung request counts as a failure. */
  private attempt(batch: ActivityEntryInput[], remainingMs: number): Promise<"sent" | "failed"> {
    return new Promise<"sent" | "failed">((resolve) => {
      const cancel = this.options.timers.after(Math.max(remainingMs, 0), () => { resolve("failed"); });
      const settle = (outcome: "sent" | "failed"): void => { cancel(); resolve(outcome); };
      let pending: Promise<unknown>;
      // Failures are retried and, when the window closes, reported by the one drop warning.
      try { pending = this.options.transport(batch); } catch (_error) { /* ignore: counted as a failed attempt */ settle("failed"); return; }
      pending.then(() => { settle("sent"); }, () => { settle("failed"); });
    });
  }
}
