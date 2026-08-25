/**
 * Deterministic scenario runner for the dev scroll harness (/dev/chat-scroll).
 *
 * Executes a scenario's timed steps against whatever scroll controller the page
 * mounted (the runner never touches the controller's internals — it only calls
 * the same public surface the chat does), while a per-frame sampler measures
 * what the user would actually see:
 *
 *  - `fromBottom` at every frame, and the worst value recorded during any
 *    moment the controller claimed to be pinned (a pinned view that is 300px
 *    off the bottom is the "drifts as it grows" bug, whatever the flag says);
 *  - pin transitions, and whether a disengage happened anywhere near real user
 *    input (a disengage with no input is the controller mistaking its own
 *    write, or layout, for the user);
 *  - visual drift while detached, measured against a real DOM anchor rather
 *    than scrollTop — prepends and bottom growth move scrollTop in opposite
 *    directions for the same on-screen result, so scrollTop can't tell you
 *    whether the reader's page moved.
 */

import { flushSync } from "react-dom";
import { assertNever } from "@shared/invariant";
import type { HarnessContent, HarnessMessage } from "./chat-scroll-model";
import { makeRandom } from "./chat-scroll-model";
import type { Scenario, Step } from "./chat-scroll-scenarios";

/** Everything the runner needs from the page. */
export interface RunContext {
  scroller: () => HTMLDivElement | null;
  content: () => HTMLDivElement | null;
  isPinned: () => boolean;
  hasUnseenContent: () => boolean;
  captureForPrepend: () => void;
  apply: (fn: (prev: HarnessContent) => HarnessContent) => void;
  log: (kind: string, detail: Record<string, string | number | boolean>) => void;
}

export interface RunSummary {
  scenario: string;
  durationMs: number;
  finalPinned: boolean;
  finalFromBottom: number;
  finalHasUnseenContent: boolean;
  maxFromBottomWhilePinned: number;
  disengageCount: number;
  reengageCount: number;
  disengagedWithoutIntent: boolean;
  driftWhileDetachedPx: number;
  samples: number;
  pass: boolean;
  failures: string[];
}

/** A user step counts as "intent" for this long afterwards. */
const INTENT_WINDOW_MS = 350;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function frame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

/** Let React render, then let the ResizeObserver/scroll cycle it triggers run. */
async function settle(): Promise<void> {
  await frame();
  await frame();
}

function fromBottomOf(el: HTMLDivElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

/** The topmost child still visible, with its offset below the scroller's top edge. */
function topVisible(scroller: HTMLDivElement, content: HTMLDivElement): { el: Element; top: number } | null {
  const scTop = scroller.getBoundingClientRect().top;
  for (const child of content.children) {
    const r = child.getBoundingClientRect();
    if (r.bottom > scTop + 1) return { el: child, top: r.top - scTop };
  }
  return null;
}

/** Per-frame measurement of what the viewer sees, independent of the controller. */
class Sampler {
  maxFromBottomWhilePinned = 0;
  disengageCount = 0;
  reengageCount = 0;
  disengagedWithoutIntent = false;
  driftWhileDetachedPx = 0;
  samples = 0;

  private prevPinned: boolean;
  private anchor: { el: Element; top: number } | null = null;
  private lastIntentAt = -Infinity;
  private running = true;
  private inResizeCycle = false;
  private observer: ResizeObserver | null = null;

  constructor(private ctx: RunContext) {
    this.prevPinned = ctx.isPinned();
  }

  markIntent(): void {
    this.lastIntentAt = performance.now();
    this.anchor = null;
  }

  private sample(): void {
    const el = this.ctx.scroller();
    const content = this.ctx.content();
    if (!el || !content) return;
    this.samples++;
    const pinned = this.ctx.isPinned();
    const fb = fromBottomOf(el);
    // Only the post-resize phase can say how far off the bottom the view
    // actually WAS: between a content mutation and the resize cycle that
    // answers it, the scroller is legitimately off the bottom and nothing has
    // been painted yet. Counting that gap would score every controller as
    // drifting by one chunk. `inResizeCycle` samples are taken from our own
    // ResizeObserver, which — registered after the controller's — runs after it
    // has already written, so it sees the state that goes to the screen.
    if (pinned && this.inResizeCycle && fb > this.maxFromBottomWhilePinned) this.maxFromBottomWhilePinned = fb;
    if (pinned !== this.prevPinned) {
      const withIntent = performance.now() - this.lastIntentAt < INTENT_WINDOW_MS;
      if (pinned) this.reengageCount++;
      else {
        this.disengageCount++;
        if (!withIntent) this.disengagedWithoutIntent = true;
      }
      this.ctx.log("pin", { pinned, fromBottom: Math.round(fb), withIntent });
      this.prevPinned = pinned;
      this.anchor = null;
    }
    if (pinned) {
      this.anchor = null;
      return;
    }
    // Detached: accumulate how far the reader's page moved on screen, ignoring
    // the window right after their own scroll (that movement is theirs).
    const fresh = performance.now() - this.lastIntentAt < INTENT_WINDOW_MS;
    const anchor = this.anchor;
    if (!anchor || !anchor.el.isConnected || fresh) {
      this.anchor = fresh ? null : topVisible(el, content);
      return;
    }
    const top = anchor.el.getBoundingClientRect().top - el.getBoundingClientRect().top;
    this.driftWhileDetachedPx += Math.abs(top - anchor.top);
    anchor.top = top;
  }

  start(): void {
    // Our own ResizeObserver, created after the controller's so it is delivered
    // after it in the same cycle: this is the phase where the controller has
    // finished reacting and the frame is about to be painted.
    const el = this.ctx.scroller();
    const content = this.ctx.content();
    if (el && content) {
      const ro = new ResizeObserver(() => {
        this.inResizeCycle = true;
        try {
          this.sample();
        } finally {
          this.inResizeCycle = false;
        }
      });
      ro.observe(el);
      ro.observe(content);
      this.observer = ro;
    }
    // Sample from a task scheduled INSIDE a frame callback, not from the frame
    // callback itself: a rAF runs before that frame's layout and before its
    // ResizeObserver delivery, so it would see the scroller mid-growth, before
    // the controller's re-pin write — a state the user never sees. The task
    // runs after layout, observers, and paint, so what it measures is what was
    // on screen.
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

function growLast(prev: HarnessContent, by: number): HarnessContent {
  const messages = prev.messages.slice();
  const last = messages[messages.length - 1];
  if (last) messages[messages.length - 1] = { ...last, px: Math.max(20, last.px + by) };
  return { ...prev, messages };
}

interface StepDeps {
  ctx: RunContext;
  sampler: Sampler;
}

class HarnessNotMountedError extends Error {
  constructor() {
    super("the harness scroller is not mounted");
    this.name = "HarnessNotMountedError";
  }
}

async function runStep(step: Step, deps: StepDeps): Promise<void> {
  const { ctx, sampler } = deps;
  const el = ctx.scroller();
  if (!el) throw new HarnessNotMountedError();
  ctx.log("step", { k: step.k, ...stepDetail(step) });
  switch (step.k) {
    case "wait":
      await delay(step.ms);
      return;
    case "append":
      ctx.apply((prev) => ({
        ...prev,
        messages: [...prev.messages, { id: prev.nextId, role: step.role, px: step.px }],
        nextId: prev.nextId + 1,
      }));
      await settle();
      return;
    case "stream":
      for (let i = 0; i < step.chunks; i++) {
        ctx.apply((prev) => growLast(prev, step.chunkPx));
        await delay(step.intervalMs);
      }
      await settle();
      return;
    case "finalize":
      ctx.apply((prev) => growLast(prev, -step.shrinkBy));
      await settle();
      return;
    case "prepend":
      ctx.captureForPrepend();
      ctx.apply((prev) => prependOlder(prev, step.count));
      await settle();
      return;
    case "chromeResize":
      ctx.apply((prev) => ({ ...prev, chromePx: step.px }));
      await settle();
      return;
    case "imageDecode":
      ctx.apply((prev) => growAt(prev, { index: step.msgIndex, by: step.px }));
      await settle();
      return;
    case "userWheel":
      // A real wheel does both: the input event the controller listens for AND
      // the scrollTop move. Either one alone is a different (fake) gesture.
      sampler.markIntent();
      el.dispatchEvent(new WheelEvent("wheel", { deltaY: step.deltaY, bubbles: true, cancelable: true }));
      el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + step.deltaY));
      await settle();
      return;
    case "userDrag":
      // A scrollbar-thumb drag: position moves with no input event at all.
      sampler.markIntent();
      el.scrollTop = step.toTop;
      await settle();
      return;
    case "keyboardClamp":
      ctx.apply((prev) => ({ ...prev, viewportShrinkPx: step.px }));
      await delay(step.holdMs);
      ctx.apply((prev) => ({ ...prev, viewportShrinkPx: 0 }));
      await settle();
      return;
    default:
      assertNever(step);
  }
}

function prependOlder(prev: HarnessContent, count: number): HarnessContent {
  const rnd = makeRandom(prev.nextId * 7919);
  const older: HarnessMessage[] = [];
  for (let i = 0; i < count; i++) {
    const assistant = i % 2 === 1;
    older.push({
      id: prev.nextId + i,
      role: assistant ? "assistant" : "user",
      px: assistant ? 60 + Math.floor(rnd() * 200) : 34 + Math.floor(rnd() * 40),
    });
  }
  return { ...prev, messages: [...older, ...prev.messages], nextId: prev.nextId + count };
}

function growAt(prev: HarnessContent, at: { index: number; by: number }): HarnessContent {
  const messages = prev.messages.slice();
  const target = messages[at.index];
  if (target) messages[at.index] = { ...target, px: target.px + at.by };
  return { ...prev, messages };
}

function stepDetail(step: Step): Record<string, string | number | boolean> {
  const detail: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(step)) {
    if (key !== "k" && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) {
      detail[key] = value;
    }
  }
  return detail;
}

function evaluate(scenario: Scenario, summary: Omit<RunSummary, "pass" | "failures">): string[] {
  const e = scenario.expect;
  const failures: string[] = [];
  const check = (ok: boolean, message: string): void => {
    if (!ok) failures.push(message);
  };
  if (e.finalPinned !== undefined) check(summary.finalPinned === e.finalPinned, `finalPinned ${summary.finalPinned} !== ${e.finalPinned}`);
  if (e.finalFromBottomAtMost !== undefined) check(summary.finalFromBottom <= e.finalFromBottomAtMost, `finalFromBottom ${summary.finalFromBottom} > ${e.finalFromBottomAtMost}`);
  if (e.maxFromBottomWhilePinnedAtMost !== undefined) {
    check(summary.maxFromBottomWhilePinned <= e.maxFromBottomWhilePinnedAtMost, `maxFromBottomWhilePinned ${summary.maxFromBottomWhilePinned} > ${e.maxFromBottomWhilePinnedAtMost}`);
  }
  if (e.disengagedWithoutIntent !== undefined) {
    check(summary.disengagedWithoutIntent === e.disengagedWithoutIntent, `disengagedWithoutIntent ${summary.disengagedWithoutIntent} !== ${e.disengagedWithoutIntent}`);
  }
  if (e.driftWhileDetachedAtMost !== undefined) check(summary.driftWhileDetachedPx <= e.driftWhileDetachedAtMost, `driftWhileDetachedPx ${summary.driftWhileDetachedPx} > ${e.driftWhileDetachedAtMost}`);
  if (e.finalHasUnseenContent !== undefined) {
    check(summary.finalHasUnseenContent === e.finalHasUnseenContent, `finalHasUnseenContent ${summary.finalHasUnseenContent} !== ${e.finalHasUnseenContent}`);
  }
  return failures;
}

/** Run one scenario to completion and report what the viewer would have seen. */
export async function runScenario(scenario: Scenario, ctx: RunContext): Promise<RunSummary> {
  const sampler = new Sampler(ctx);
  const startedAt = performance.now();
  ctx.log("scenario-start", { name: scenario.name });
  sampler.start();
  try {
    for (const step of scenario.steps) await runStep(step, { ctx, sampler });
    await settle();
  } finally {
    sampler.stop();
  }
  const el = ctx.scroller();
  const measured = {
    scenario: scenario.name,
    durationMs: Math.round(performance.now() - startedAt),
    finalPinned: ctx.isPinned(),
    finalFromBottom: el ? Math.round(fromBottomOf(el)) : -1,
    finalHasUnseenContent: ctx.hasUnseenContent(),
    maxFromBottomWhilePinned: Math.round(sampler.maxFromBottomWhilePinned),
    disengageCount: sampler.disengageCount,
    reengageCount: sampler.reengageCount,
    disengagedWithoutIntent: sampler.disengagedWithoutIntent,
    driftWhileDetachedPx: Math.round(sampler.driftWhileDetachedPx),
    samples: sampler.samples,
  };
  const failures = evaluate(scenario, measured);
  const summary: RunSummary = { ...measured, pass: failures.length === 0, failures };
  ctx.log("scenario-end", { name: scenario.name, pass: summary.pass, failures: failures.join("; ") });
  return summary;
}

/** Apply a content mutation and force React to render it before returning. */
export function flushApply(mutate: () => void): void {
  flushSync(mutate);
}
