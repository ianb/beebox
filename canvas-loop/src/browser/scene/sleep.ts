// When a scene figure sleeps (draft section 20). Off screen its loop stops at
// once; after `RELEASE_AFTER_MS` still off screen its GPU resources are
// released. Back on screen within that time it just resumes. After a release,
// waking draws the kept record again (on a new device if the old one was
// lost) and resumes only once that succeeded; a failed wake stays retryable.

/** Off screen this long, a figure frees its GPU resources. */
export const RELEASE_AFTER_MS = 2000;

/** What sleeping and waking act on: the runtime's loop and the surface's GPU resources. */
export interface SleepTarget {
  /** Stop the loop (time stops with it). */
  suspend(): void;
  /** Restart a suspended loop. */
  resume(): void;
  /** Free the GPU resources. */
  release(): Promise<void>;
  /** Draw the kept record again, reopening a lost device; may reject. */
  restore(): Promise<void>;
  /** Whether `restore` left the figure drawing (not lost, failed or torn down). */
  restored(): boolean;
  /** `restore` rejected; the figure stays released and a later wake tries again. */
  onRestoreFailed(error: unknown): void;
  /** `restore` succeeded (hide any notice). */
  onRestored(): void;
}

type Phase = "on" | "pending" | "released" | "waking";

export class FigureSleep {
  readonly #t: SleepTarget;
  readonly #graceMs: number;
  #phase: Phase = "on";
  #visible = true;
  #ended = false;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(target: SleepTarget, options?: { graceMs?: number }) {
    this.#t = target;
    this.#graceMs = options?.graceMs ?? RELEASE_AFTER_MS;
  }

  get phase(): Phase {
    return this.#phase;
  }

  /** The visibility watcher's call. On screen, resolves once the figure draws again (or the wake failed). */
  async setOnScreen(onScreen: boolean): Promise<void> {
    this.#visible = onScreen;
    if (this.#ended) return;
    if (!onScreen) {
      if (this.#phase !== "on") return;
      this.#t.suspend();
      this.#phase = "pending";
      this.#timer = setTimeout(() => this.#release(), this.#graceMs);
      return;
    }
    if (this.#phase === "pending") {
      this.#clearTimer();
      this.#phase = "on";
      this.#t.resume();
      return;
    }
    if (this.#phase !== "released") return;
    await this.#wake();
  }

  #release(): void {
    this.#timer = undefined;
    if (this.#ended || this.#phase !== "pending") return;
    this.#phase = "released";
    void this.#t.release();
  }

  async #wake(): Promise<void> {
    this.#phase = "waking";
    try {
      await this.#t.restore();
    } catch (error) {
      this.#phase = "released";
      if (!this.#ended) this.#t.onRestoreFailed(error);
      return;
    }
    if (this.#ended) return;
    if (!this.#t.restored()) {
      this.#phase = "released";
      return;
    }
    this.#phase = "on";
    this.#t.onRestored();
    if (this.#visible) this.#t.resume();
    else await this.setOnScreen(false);
  }

  /** The device was lost: stop the loop now; the next wake (or retry) reopens. */
  lost(): void {
    this.#clearTimer();
    this.#t.suspend();
    if (!this.#ended && this.#phase !== "waking") this.#phase = "released";
  }

  /** Teardown or a terminal error: no more sleeping or waking. */
  end(): void {
    this.#ended = true;
    this.#clearTimer();
  }

  #clearTimer(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}
