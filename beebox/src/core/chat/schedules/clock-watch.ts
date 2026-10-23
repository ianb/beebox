import { isWalkFixture } from "../../../lib/box-fixture.js";
import { storedClockOffsetMs } from "../../../lib/time.js";

/**
 * Watches a box's clock offset while it has armed timers: a journey walk's
 * wait moves box time, so timers armed against the old time are stale. Only a
 * walk fixture can have an applied offset.
 *
 * The offset is read when the watch starts and compared on every poll. An
 * `fs.watchFile` watcher took its first reading asynchronously, so an offset
 * written just after a check-in was armed could become its baseline and never
 * read as a change; reading it here, synchronously, closes that gap. What
 * remains is the instant between a timer reading box time and this read, in
 * the same synchronous call. The poll timer is unref'd so it never holds the
 * process open.
 */
export class ClockWatch {
  private timer: NodeJS.Timeout | null = null;
  private offsetMs = 0;

  constructor(private readonly boxRoot: string, private readonly options: { intervalMs: number; hasTimers: () => boolean; onChange: () => void }) {}

  isWatching(): boolean {
    return this.timer !== null;
  }

  /** Start watching when timers exist and nothing watches; stop when none remain. */
  sync(): void {
    const hasTimers = this.options.hasTimers();
    if (hasTimers && this.timer === null && isWalkFixture(this.boxRoot)) {
      this.offsetMs = storedClockOffsetMs(this.boxRoot);
      this.timer = setInterval(() => { this.poll(); }, this.options.intervalMs);
      this.timer.unref();
    } else if (!hasTimers && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private poll(): void {
    const offsetMs = storedClockOffsetMs(this.boxRoot);
    if (offsetMs === this.offsetMs) return;
    this.offsetMs = offsetMs;
    this.options.onChange();
  }
}
