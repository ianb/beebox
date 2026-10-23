import * as fs from "node:fs";
import { isWalkFixture } from "../../../lib/box-fixture.js";
import { clockOffsetPath } from "../../../lib/time.js";

/**
 * Watches a box's clock offset file while it has armed timers: a journey
 * walk's wait moves box time, so timers armed against the old time are stale.
 * Only a walk fixture can have an applied offset. `persistent: false` keeps
 * the poll from holding the process open.
 */
export class ClockWatch {
  private listener: (() => void) | null = null;

  constructor(private readonly boxRoot: string, private readonly options: { intervalMs: number; hasTimers: () => boolean; onChange: () => void }) {}

  isWatching(): boolean {
    return this.listener !== null;
  }

  /** Start watching when timers exist and nothing watches; stop when none remain. */
  sync(): void {
    const hasTimers = this.options.hasTimers();
    if (hasTimers && this.listener === null && isWalkFixture(this.boxRoot)) {
      this.listener = this.options.onChange;
      fs.watchFile(clockOffsetPath(this.boxRoot), { interval: this.options.intervalMs, persistent: false }, this.listener);
    } else if (!hasTimers && this.listener !== null) {
      fs.unwatchFile(clockOffsetPath(this.boxRoot), this.listener);
      this.listener = null;
    }
  }
}
