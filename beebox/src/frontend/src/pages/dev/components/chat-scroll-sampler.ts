/**
 * Measurement for the dev scroll harness (/dev/chat-scroll): the context the
 * runner drives a controller through, and the per-frame sampler that records
 * what a viewer would actually have seen — independent of anything the
 * controller claims about itself.
 *
 * Split from the runner (which executes the steps) so "what happened" and "what
 * we did" stay separable: every number a scenario asserts on is produced here,
 * from the DOM.
 */

import type { HarnessContent } from "./chat-scroll-model";

/** Everything the runner needs from the page. */
export interface RunContext {
  scroller: () => HTMLDivElement | null;
  content: () => HTMLDivElement | null;
  atBottom: () => boolean;
  hasUnseenContent: () => boolean;
  captureForPrepend: () => void;
  /** Anchor the newest user message to the top of the viewport (the send write). */
  anchorSend: () => void;
  scrollToBottom: (opts?: { behavior?: ScrollBehavior }) => void;
  openThread: () => void;
  settleOpen: (opts?: { until?: Promise<void> }) => void;
  /** Programmatic writes the controller has made since the page loaded. */
  writeCount: () => number;
  apply: (fn: (prev: HarnessContent) => HarnessContent) => void;
  log: (kind: string, detail: Record<string, string | number | boolean>) => void;
}

/** A user step counts as "intent" for this long afterwards. */
const INTENT_WINDOW_MS = 350;

export function fromBottomOf(el: HTMLDivElement): number {
  const live = el.querySelector("[data-chat-live-turn-content]");
  if (live) return Math.max(0, live.getBoundingClientRect().bottom - el.getBoundingClientRect().top - el.clientHeight);
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

/** The topmost child still visible, with its offset below the scroller's top edge. */
function topVisible(scroller: HTMLDivElement, content: HTMLDivElement): { el: Element; top: number } | null {
  const scTop = scroller.getBoundingClientRect().top;
  const scBottom = scroller.getBoundingClientRect().bottom;
  for (const token of content.querySelectorAll("[data-harness-token]")) {
    const r = token.getBoundingClientRect();
    if (r.bottom > scTop + 1 && r.top < scBottom) return { el: token, top: r.top - scTop };
  }
  for (const child of content.children) {
    const r = child.getBoundingClientRect();
    if (r.bottom > scTop + 1) return { el: child, top: r.top - scTop };
  }
  return null;
}

/** The observed boxes identify which resize cycle a DOM read belongs to. */
function sizeGeneration(scroller: HTMLDivElement, content: HTMLDivElement): string {
  const rect = content.getBoundingClientRect();
  return [scroller.clientWidth, scroller.clientHeight, rect.width, rect.height].join(":");
}

/** Per-frame measurement of layout, independent of the controller. */
export class Sampler {
  maxFromBottomWhileAtBottom = 0;
  leftBottomCount = 0;
  reachedBottomCount = 0;
  leftBottomWithoutIntent = false;
  driftWhileAwayPx = 0;
  flingReversals = 0;
  samples = 0;
  invalidReason: string | null = null;
  private observed: { el: Element; content: Element } | null = null;

  private prevAtBottom: boolean;
  private anchor: { el: Element; top: number } | null = null;
  private intentUntil = -Infinity;
  private running = true;
  private inResizeCycle = false;
  private observer: ResizeObserver | null = null;
  private lastResizeSize: string | null = null;

  constructor(private ctx: RunContext) {
    this.prevAtBottom = ctx.atBottom();
  }

  markIntent(durationMs?: number): void {
    this.intentUntil = performance.now() + (durationMs ?? INTENT_WINDOW_MS);
    this.anchor = null;
  }

  observeReadingPosition(): void {
    this.intentUntil = -Infinity;
    const el = this.ctx.scroller();
    const content = this.ctx.content();
    this.anchor = el && content ? topVisible(el, content) : null;
  }

  private sample(): void {
    const el = this.ctx.scroller();
    const content = this.ctx.content();
    if (!el || !content || el !== this.observed?.el || content !== this.observed.content) {
      this.invalidReason = "Sampler observed elements missing or replaced";
      return;
    }
    // A timer can run after an image mutation but before the NEXT rendering
    // update. Its forced layout is not yet reconciled or painted. Keep the
    // old anchor until the observer samples that size generation; same-size
    // scroll movement still gets sampled by tasks.
    if (!this.inResizeCycle && sizeGeneration(el, content) !== this.lastResizeSize) {
      this.ctx.log("sample-deferred", { reason: "pending-resize" });
      return;
    }
    this.samples++;
    const atBottom = this.ctx.atBottom();
    const fb = fromBottomOf(el);
    // Only the post-resize phase can say how far off the bottom the view
    // actually WAS: between a content mutation and the resize cycle that
    // answers it, the scroller is legitimately off the bottom and nothing has
    // been painted yet. `inResizeCycle` samples are taken from our own
    // ResizeObserver, which — registered after the controller's — runs after it
    // has already written, so it sees the state that goes to the screen.
    if (atBottom && this.inResizeCycle && fb > this.maxFromBottomWhileAtBottom) this.maxFromBottomWhileAtBottom = fb;
    if (atBottom !== this.prevAtBottom) {
      const withIntent = performance.now() < this.intentUntil;
      if (atBottom) this.reachedBottomCount++;
      else {
        this.leftBottomCount++;
        if (!withIntent) this.leftBottomWithoutIntent = true;
      }
      this.ctx.log("at-bottom", { atBottom, fromBottom: Math.round(fb), withIntent });
      this.prevAtBottom = atBottom;
      this.anchor = null;
    }
    if (atBottom) {
      this.anchor = null;
      return;
    }
    // Away from the bottom: accumulate how far the reader's page moved on
    // screen, ignoring the window right after their own scroll (that movement
    // is theirs).
    const fresh = performance.now() < this.intentUntil;
    const anchor = this.anchor;
    if (!anchor || !anchor.el.isConnected || fresh) {
      this.anchor = fresh ? null : topVisible(el, content);
      return;
    }
    const top = anchor.el.getBoundingClientRect().top - el.getBoundingClientRect().top;
    const delta = top - anchor.top;
    if (Math.abs(delta) > 0.1) this.ctx.log("sample-drift", {
      phase: this.inResizeCycle ? "resize" : "task",
      delta, top, previous: anchor.top, scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
    });
    this.driftWhileAwayPx += Math.abs(delta);
    anchor.top = top;
  }

  start(): void {
    // Our own ResizeObserver, created after the controller's so it is delivered
    // after it in the same cycle: this is the phase where the controller has
    // finished reacting and the frame is about to be painted.
    const el = this.ctx.scroller();
    const content = this.ctx.content();
    if (el && content) {
      this.observed = { el, content };
      const ro = new ResizeObserver(() => {
        this.inResizeCycle = true;
        try {
          this.sample();
          this.lastResizeSize = sizeGeneration(el, content);
        } finally {
          this.inResizeCycle = false;
        }
      });
      ro.observe(el);
      ro.observe(content);
      this.observer = ro;
    } else {
      this.invalidReason = "Sampler started without elements";
    }
    // Between resize cycles, sample scroll movement from tasks. A task isn't
    // a post-paint guarantee: sample() rejects sizes that haven't reached our
    // observer yet. The phase-tagged drift log keeps this distinction visible.
    const tick = (): void => {
      if (!this.running) return;
      window.requestAnimationFrame(() => {
        window.setTimeout(() => {
          if (!this.running) return;
          this.sample();
          tick();
        }, 0);
      });
    };
    tick();
  }

  stop(): void {
    this.running = false;
    if (this.observer) this.observer.disconnect();
    this.observer = null;
  }
}
